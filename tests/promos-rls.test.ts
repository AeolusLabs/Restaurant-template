import { sql } from "drizzle-orm";
import { afterAll, describe, expect, inject, test } from "vitest";
import { closePools, withRequestContext, withSystemContext } from "../src/db/context";
import { admin, closeFixtures, makeOrder, makeUser } from "./helpers/fixtures";

const urls = inject("dbUrls");
const o = { url: urls.app };
afterAll(async () => {
  await closePools();
  await closeFixtures();
});
type Ctx = Parameters<typeof withRequestContext>[0];

let n = 0;
const code = () => `T${Date.now().toString(36)}${++n}`.toUpperCase().slice(0, 20);
async function makePromo(over: { kind?: string; value?: number | null; active?: boolean } = {}) {
  const c = code();
  const kind = over.kind ?? "percent";
  const value = over.value === undefined ? (kind === "free_delivery" ? null : 1000) : over.value;
  const { rows } = await admin().query(`insert into promos (code, kind, value, active) values ($1, $2, $3, $4) returning id`, [c, kind, value, over.active ?? true]);
  return { id: rows[0].id as string, code: c };
}
const visible = (ctx: Ctx, promoId: string) => withRequestContext(ctx, async (tx) => (await tx.execute(sql`select 1 from promos where id = ${promoId}::uuid`)).rows.length, o);
const byCode = (ctx: Ctx, c: string) => withRequestContext(ctx, async (tx) => (await tx.execute(sql`select * from promo_for_code(${c})`)).rows, o);
const usage = (ctx: Ctx, promoId: string, profileId: string) =>
  withRequestContext(ctx, async (tx) => (await tx.execute(sql`select total, mine from promo_usage(${promoId}::uuid, ${profileId}::uuid)`)).rows[0] as { total: number; mine: number }, o);

describe("promos access", () => {
  test("managers and owners read the table; customers and the kitchen see nothing", async () => {
    const p = await makePromo();
    expect(await visible((await makeUser("manager")).ctx, p.id)).toBe(1);
    expect(await visible((await makeUser("owner")).ctx, p.id)).toBe(1);
    expect(await visible((await makeUser("customer")).ctx, p.id)).toBe(0);
    expect(await visible((await makeUser("kitchen")).ctx, p.id)).toBe(0);
  });

  test("managers and owners create and change promos; customers and the kitchen cannot", async () => {
    for (const role of ["manager", "owner"] as const) {
      const ctx = (await makeUser(role)).ctx;
      const c = code();
      await withRequestContext(ctx, (tx) => tx.execute(sql`insert into promos (code, kind, value) values (${c}, 'fixed', 50000)`), o);
      await withRequestContext(ctx, (tx) => tx.execute(sql`update promos set active = false where code = ${c}`), o);
      expect((await admin().query(`select active from promos where code = $1`, [c])).rows[0].active).toBe(false);
    }
    const p = await makePromo();
    for (const role of ["customer", "kitchen"] as const) {
      const ctx = (await makeUser(role)).ctx;
      await expect(withRequestContext(ctx, (tx) => tx.execute(sql`insert into promos (code, kind, value) values (${code()}, 'fixed', 1)`), o)).rejects.toThrow();
      await withRequestContext(ctx, (tx) => tx.execute(sql`update promos set active = false where id = ${p.id}::uuid`), o); // no row visible, so nothing changes
      expect((await admin().query(`select active from promos where id = $1`, [p.id])).rows[0].active).toBe(true);
    }
  });

  test("nobody in the app role can delete a promo", async () => {
    const p = await makePromo();
    for (const role of ["manager", "owner", "customer"] as const) {
      await expect(withRequestContext((await makeUser(role)).ctx, (tx) => tx.execute(sql`delete from promos where id = ${p.id}::uuid`), o)).rejects.toThrow();
    }
  });

  test("the database refuses a promo that makes no sense", async () => {
    const bad: [string, string, number | null][] = [
      ["percent over 100%", "percent", 10_001],
      ["percent of nothing", "percent", 0],
      ["fixed of nothing", "fixed", 0],
      ["free delivery with a value", "free_delivery", 5],
      ["percent with no value", "percent", null],
    ];
    for (const [name, kind, value] of bad) {
      await expect(admin().query(`insert into promos (code, kind, value) values ($1, $2, $3)`, [code(), kind, value]), name).rejects.toThrow(/check/i);
    }
    await expect(admin().query(`insert into promos (code, kind, value) values ('lower', 'fixed', 1)`)).rejects.toThrow(/check/i);
    await expect(admin().query(`insert into promos (code, kind, value) values ('AB', 'fixed', 1)`)).rejects.toThrow(/check/i);
    await expect(admin().query(`insert into promos (code, kind, value, max_redemptions) values ($1, 'fixed', 1, 0)`, [code()])).rejects.toThrow(/check/i);
    await expect(admin().query(`insert into promos (code, kind, value, starts_at, expires_at) values ($1, 'fixed', 1, now(), now() - interval '1 day')`, [code()])).rejects.toThrow(/check/i);
  });

  test("a code is unique", async () => {
    const p = await makePromo();
    await expect(admin().query(`insert into promos (code, kind, value) values ($1, 'fixed', 1)`, [p.code])).rejects.toThrow(/unique|duplicate/i);
  });
});

describe("promo_for_code", () => {
  test("anyone signed in who knows the code can look it up, whatever case they type", async () => {
    const p = await makePromo();
    const customer = (await makeUser("customer")).ctx;
    expect(await byCode(customer, p.code)).toHaveLength(1);
    expect(await byCode(customer, ` ${p.code.toLowerCase()} `)).toHaveLength(1);
  });

  test("an unknown code finds nothing, and it never lists other promos", async () => {
    await makePromo();
    expect(await byCode((await makeUser("customer")).ctx, "NOSUCHCODE")).toHaveLength(0);
    expect(await byCode((await makeUser("customer")).ctx, "%")).toHaveLength(0);
  });

  test("it does not leave the table open to the caller afterwards", async () => {
    const p = await makePromo();
    const customer = (await makeUser("customer")).ctx;
    const seen = await withRequestContext(
      customer,
      async (tx) => {
        await tx.execute(sql`select * from promo_for_code(${p.code})`);
        return (await tx.execute(sql`select 1 from promos`)).rows.length;
      },
      o,
    );
    expect(seen).toBe(0);
  });

  test("with no identity it refuses", async () => {
    await expect(withSystemContext((tx) => tx.execute(sql`select set_config('app.role', '', true), set_config('app.user_id', '', true)`).then(() => tx.execute(sql`select * from promo_for_code('X')`)), { url: urls.system })).rejects.toThrow();
  });
});

describe("redemptions", () => {
  async function redeem(profileId: string, promoId: string, status: "placed" | "paid" = "placed") {
    const { orderId } = await makeOrder(profileId, status);
    await admin().query(`insert into promo_redemptions (promo_id, order_id, profile_id, discount_minor) values ($1, $2, $3, 100000)`, [promoId, orderId, profileId]);
    return orderId;
  }

  test("usage counts everyone and the asking customer separately", async () => {
    const p = await makePromo();
    const a = await makeUser("customer");
    const b = await makeUser("customer");
    await redeem(a.userId, p.id);
    await redeem(a.userId, p.id);
    await redeem(b.userId, p.id);
    expect(await usage(a.ctx, p.id, a.userId)).toEqual({ total: 3, mine: 2 });
    expect(await usage(b.ctx, p.id, b.userId)).toEqual({ total: 3, mine: 1 });
  });

  test("a customer cannot ask how often someone else used a code", async () => {
    const p = await makePromo();
    const a = await makeUser("customer");
    const b = await makeUser("customer");
    await expect(usage(a.ctx, p.id, b.userId)).rejects.toMatchObject({ cause: { code: "42501" } });
  });

  test("an order cancelled while unpaid gives its use back; a paid one that is later cancelled does not", async () => {
    const p = await makePromo();
    const a = await makeUser("customer");
    const unpaid = await redeem(a.userId, p.id, "placed");
    const paid = await redeem(a.userId, p.id, "paid");
    expect((await usage(a.ctx, p.id, a.userId)).total).toBe(2);

    await withSystemContext((tx) => tx.execute(sql`select transition_order(${unpaid}::uuid, 'cancelled'::order_status, 'placed'::order_status, 'expired', '{}'::jsonb)`), { url: urls.system });
    expect(await usage(a.ctx, p.id, a.userId)).toEqual({ total: 1, mine: 1 });

    await withRequestContext((await makeUser("manager")).ctx, (tx) => tx.execute(sql`select transition_order(${paid}::uuid, 'cancelled'::order_status, 'paid'::order_status, 'staff cancelled', '{}'::jsonb)`), o);
    expect(await usage(a.ctx, p.id, a.userId)).toEqual({ total: 1, mine: 1 });
  });

  test("a customer can record a use for their own order only, and for themselves only", async () => {
    const p = await makePromo();
    const a = await makeUser("customer");
    const b = await makeUser("customer");
    const mine = (await makeOrder(a.userId)).orderId;
    const theirs = (await makeOrder(b.userId)).orderId;
    const insert = (ctx: Ctx, orderId: string, profileId: string) =>
      withRequestContext(ctx, (tx) => tx.execute(sql`insert into promo_redemptions (promo_id, order_id, profile_id, discount_minor) values (${p.id}::uuid, ${orderId}::uuid, ${profileId}::uuid, 1)`), o);
    await expect(insert(a.ctx, theirs, a.userId)).rejects.toThrow();
    await expect(insert(a.ctx, mine, b.userId)).rejects.toThrow();
    await insert(a.ctx, mine, a.userId);
    expect((await admin().query(`select 1 from promo_redemptions where order_id = $1`, [mine])).rowCount).toBe(1);
  });

  test("staff cannot record a use, a customer cannot read or change them, and managers can read", async () => {
    const p = await makePromo();
    const a = await makeUser("customer");
    const orderId = await redeem(a.userId, p.id);
    const count = (ctx: Ctx) => withRequestContext(ctx, async (tx) => (await tx.execute(sql`select 1 from promo_redemptions where order_id = ${orderId}::uuid`)).rows.length, o);
    expect(await count((await makeUser("manager")).ctx)).toBe(1);
    expect(await count((await makeUser("owner")).ctx)).toBe(1);
    expect(await count(a.ctx)).toBe(0);
    expect(await count((await makeUser("kitchen")).ctx)).toBe(0);
    const other = (await makeOrder(a.userId)).orderId;
    await expect(
      withRequestContext((await makeUser("manager")).ctx, (tx) => tx.execute(sql`insert into promo_redemptions (promo_id, order_id, profile_id, discount_minor) values (${p.id}::uuid, ${other}::uuid, ${a.userId}::uuid, 1)`), o),
    ).rejects.toThrow();
    await expect(withRequestContext(a.ctx, (tx) => tx.execute(sql`update promo_redemptions set released_at = now() where order_id = ${orderId}::uuid`), o)).rejects.toThrow();
    expect((await admin().query(`select released_at from promo_redemptions where order_id = $1`, [orderId])).rows[0].released_at).toBeNull();
  });

  test("an order can carry only one promo", async () => {
    const p = await makePromo();
    const q = await makePromo();
    const a = await makeUser("customer");
    const orderId = await redeem(a.userId, p.id);
    await expect(admin().query(`insert into promo_redemptions (promo_id, order_id, profile_id, discount_minor) values ($1, $2, $3, 1)`, [q.id, orderId, a.userId])).rejects.toThrow(/unique|duplicate/i);
  });
});
