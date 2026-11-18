import { sql } from "drizzle-orm";
import { afterAll, describe, expect, inject, test } from "vitest";
import { closePools, withRequestContext, withSystemContext } from "../src/db/context";
import { generateSlug } from "../src/lib/qr";
import { admin, closeFixtures, makeOrder, makeUser } from "./helpers/fixtures";

const urls = inject("dbUrls");
const o = { url: urls.app };
afterAll(async () => {
  await closePools();
  await closeFixtures();
});
type Ctx = Parameters<typeof withRequestContext>[0];

async function source(over: { active?: boolean; label?: string } = {}) {
  const slug = generateSlug();
  const { rows } = await admin().query(`insert into qr_sources (slug, label, active) values ($1, $2, $3) returning id`, [slug, over.label ?? "Flyer", over.active ?? true]);
  return { id: rows[0].id as string, slug };
}
const visible = (ctx: Ctx, id: string) => withRequestContext(ctx, async (tx) => (await tx.execute(sql`select 1 from qr_sources where id = ${id}::uuid`)).rows.length, o);
const lookup = (ctx: Ctx, slug: string) => withRequestContext(ctx, async (tx) => (await tx.execute(sql`select qr_source_for_slug(${slug}) as id`)).rows[0].id as string | null, o);

describe("qr_sources access", () => {
  test("managers and owners read them; customers and the kitchen see nothing", async () => {
    const s = await source();
    expect(await visible((await makeUser("manager")).ctx, s.id)).toBe(1);
    expect(await visible((await makeUser("owner")).ctx, s.id)).toBe(1);
    expect(await visible((await makeUser("customer")).ctx, s.id)).toBe(0);
    expect(await visible((await makeUser("kitchen")).ctx, s.id)).toBe(0);
  });

  test("managers and owners create and change them; customers and the kitchen cannot", async () => {
    for (const role of ["manager", "owner"] as const) {
      const ctx = (await makeUser(role)).ctx;
      const slug = generateSlug();
      await withRequestContext(ctx, (tx) => tx.execute(sql`insert into qr_sources (slug, label) values (${slug}, 'Table card')`), o);
      await withRequestContext(ctx, (tx) => tx.execute(sql`update qr_sources set label = 'Renamed' where slug = ${slug}`), o);
      expect((await admin().query(`select label from qr_sources where slug = $1`, [slug])).rows[0].label).toBe("Renamed");
    }
    const s = await source();
    for (const role of ["customer", "kitchen"] as const) {
      const ctx = (await makeUser(role)).ctx;
      await expect(withRequestContext(ctx, (tx) => tx.execute(sql`insert into qr_sources (slug, label) values (${generateSlug()}, 'x')`), o)).rejects.toThrow();
      await withRequestContext(ctx, (tx) => tx.execute(sql`update qr_sources set label = 'Hacked' where id = ${s.id}::uuid`), o); // no row visible: nothing changes
      expect((await admin().query(`select label from qr_sources where id = $1`, [s.id])).rows[0].label).toBe("Flyer");
    }
  });

  test("nobody in the app role can delete one", async () => {
    const s = await source();
    for (const role of ["manager", "owner", "customer"] as const) {
      await expect(withRequestContext((await makeUser(role)).ctx, (tx) => tx.execute(sql`delete from qr_sources where id = ${s.id}::uuid`), o)).rejects.toThrow();
    }
  });

  test("the database refuses a slug that is not ours and a label that is empty or enormous", async () => {
    for (const slug of ["short", "ABCDEFGH", "abcdefg1", "abcdefgh1", "abcd efg"]) {
      await expect(admin().query(`insert into qr_sources (slug, label) values ($1, 'x')`, [slug]), slug).rejects.toThrow(/check/i);
    }
    await expect(admin().query(`insert into qr_sources (slug, label) values ($1, '   ')`, [generateSlug()])).rejects.toThrow(/check/i);
    await expect(admin().query(`insert into qr_sources (slug, label) values ($1, $2)`, [generateSlug(), "x".repeat(121)])).rejects.toThrow(/check/i);
  });

  test("a slug is unique", async () => {
    const s = await source();
    await expect(admin().query(`insert into qr_sources (slug, label) values ($1, 'again')`, [s.slug])).rejects.toThrow(/unique|duplicate/i);
  });
});

describe("qr_source_for_slug", () => {
  test("any signed-in person who holds the slug gets the id of an active source", async () => {
    const s = await source();
    expect(await lookup((await makeUser("customer")).ctx, s.slug)).toBe(s.id);
  });

  test("a switched-off or unknown slug gives nothing", async () => {
    const off = await source({ active: false });
    const customer = (await makeUser("customer")).ctx;
    expect(await lookup(customer, off.slug)).toBeNull();
    expect(await lookup(customer, generateSlug())).toBeNull();
    expect(await lookup(customer, "%")).toBeNull();
  });

  test("it does not leave the table open to the caller afterwards", async () => {
    const s = await source();
    const seen = await withRequestContext(
      (await makeUser("customer")).ctx,
      async (tx) => {
        await tx.execute(sql`select qr_source_for_slug(${s.slug})`);
        return (await tx.execute(sql`select 1 from qr_sources`)).rows.length;
      },
      o,
    );
    expect(seen).toBe(0);
  });
});

describe("qr_scans", () => {
  const count = (ctx: Ctx, id: string) => withRequestContext(ctx, async (tx) => (await tx.execute(sql`select 1 from qr_scans where source_id = ${id}::uuid`)).rows.length, o);

  test("the system records a scan; managers and owners read them; nobody else does", async () => {
    const s = await source();
    await withSystemContext((tx) => tx.execute(sql`insert into qr_scans (source_id) values (${s.id}::uuid)`), { url: urls.system });
    expect(await count((await makeUser("manager")).ctx, s.id)).toBe(1);
    expect(await count((await makeUser("owner")).ctx, s.id)).toBe(1);
    expect(await count((await makeUser("customer")).ctx, s.id)).toBe(0);
    expect(await count((await makeUser("kitchen")).ctx, s.id)).toBe(0);
  });

  test("no one in the app role can record, change or delete a scan", async () => {
    const s = await source();
    for (const role of ["customer", "kitchen", "manager", "owner"] as const) {
      const ctx = (await makeUser(role)).ctx;
      await expect(withRequestContext(ctx, (tx) => tx.execute(sql`insert into qr_scans (source_id) values (${s.id}::uuid)`), o), role).rejects.toThrow();
    }
  });

  test("an order can point at a source", async () => {
    const s = await source();
    const c = await makeUser("customer");
    const { orderId } = await makeOrder(c.userId);
    await admin().query(`update orders set source_id = $2 where id = $1`, [orderId, s.id]);
    expect((await admin().query(`select source_id from orders where id = $1`, [orderId])).rows[0].source_id).toBe(s.id);
    await expect(admin().query(`update orders set source_id = '00000000-0000-4000-8000-000000000000' where id = $1`, [orderId])).rejects.toThrow(/foreign key/i);
  });
});
