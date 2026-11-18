import { afterAll, describe, expect, inject, test } from "vitest";
import { ForbiddenError } from "../src/auth/session";
import { closePools } from "../src/db/context";
import { PromoCodeTakenError, PromoNotFoundError, createPromo, getPromo, listPromos, setPromoActive, updatePromo } from "../src/db/promos-admin";
import type { PromoFields } from "../src/domain/promos/form";
import { admin, closeFixtures, makeOrder, makeUser } from "./helpers/fixtures";

const urls = inject("dbUrls");
const o = { url: urls.app };
afterAll(async () => {
  await closePools();
  await closeFixtures();
});

let n = 0;
const fields = (over: Partial<PromoFields> = {}): PromoFields => ({
  code: `A${Date.now().toString(36)}${++n}`.toUpperCase().slice(0, 20),
  description: "Test promo",
  kind: "percent",
  value: 1000,
  minOrderMinor: 0,
  maxDiscountMinor: null,
  startsAt: null,
  expiresAt: null,
  maxRedemptions: null,
  maxPerCustomer: 1,
  active: true,
  ...over,
});
const audit = async (action: string, target: string) => (await admin().query(`select actor_role from audit_log where action = $1 and target_id = $2`, [action, target])).rows.map((r) => r.actor_role);

describe("managing promos", () => {
  test("a manager creates a promo, and the change is recorded", async () => {
    const { ctx } = await makeUser("manager");
    const f = fields({ kind: "fixed", value: 50_000, minOrderMinor: 200_000 });
    const made = await createPromo(ctx, f, o);
    expect(await getPromo(ctx, made.id, o)).toMatchObject({ code: f.code, kind: "fixed", value: 50_000, minOrderMinor: 200_000, redemptions: 0, discountGivenMinor: 0 });
    expect(await audit("promo.created", f.code)).toEqual(["manager"]);
  });

  test("an owner can edit every field, and the code can change", async () => {
    const { ctx } = await makeUser("owner");
    const made = await createPromo(ctx, fields(), o);
    const next = fields({ description: "Changed", kind: "free_delivery", value: null, maxPerCustomer: null, maxRedemptions: 10, expiresAt: new Date("2030-01-01T00:00:00Z") });
    await updatePromo(ctx, made.id, next, o);
    expect(await getPromo(ctx, made.id, o)).toMatchObject({ code: next.code, description: "Changed", kind: "free_delivery", value: null, maxRedemptions: 10, maxPerCustomer: null });
    expect(await audit("promo.updated", next.code)).toEqual(["owner"]);
  });

  test("switching off and on is its own recorded action, and the promo is never deleted", async () => {
    const { ctx } = await makeUser("manager");
    const f = fields();
    const made = await createPromo(ctx, f, o);
    await setPromoActive(ctx, made.id, false, o);
    expect((await getPromo(ctx, made.id, o))?.active).toBe(false);
    await setPromoActive(ctx, made.id, true, o);
    expect((await getPromo(ctx, made.id, o))?.active).toBe(true);
    expect(await audit("promo.deactivated", f.code)).toEqual(["manager"]);
    expect(await audit("promo.activated", f.code)).toEqual(["manager"]);
  });

  test("a code that is already taken is refused with a clear error, on create and on edit", async () => {
    const { ctx } = await makeUser("manager");
    const a = await createPromo(ctx, fields(), o);
    const b = await createPromo(ctx, fields(), o);
    const taken = (await getPromo(ctx, a.id, o))!.code;
    await expect(createPromo(ctx, fields({ code: taken }), o)).rejects.toBeInstanceOf(PromoCodeTakenError);
    await expect(updatePromo(ctx, b.id, fields({ code: taken }), o)).rejects.toBeInstanceOf(PromoCodeTakenError);
  });

  test("an unknown promo is not found", async () => {
    const { ctx } = await makeUser("manager");
    expect(await getPromo(ctx, "00000000-0000-4000-8000-000000000000", o)).toBeNull();
    await expect(updatePromo(ctx, "00000000-0000-4000-8000-000000000000", fields(), o)).rejects.toBeInstanceOf(PromoNotFoundError);
    await expect(setPromoActive(ctx, "00000000-0000-4000-8000-000000000000", false, o)).rejects.toBeInstanceOf(PromoNotFoundError);
  });

  test("kitchen and customers cannot list, read or change promos", async () => {
    const owner = (await makeUser("owner")).ctx;
    const made = await createPromo(owner, fields(), o);
    for (const role of ["kitchen", "customer"] as const) {
      const { ctx } = await makeUser(role);
      await expect(listPromos(ctx, o), role).rejects.toBeInstanceOf(ForbiddenError);
      await expect(getPromo(ctx, made.id, o), role).rejects.toBeInstanceOf(ForbiddenError);
      await expect(createPromo(ctx, fields(), o), role).rejects.toBeInstanceOf(ForbiddenError);
      await expect(updatePromo(ctx, made.id, fields(), o), role).rejects.toBeInstanceOf(ForbiddenError);
      await expect(setPromoActive(ctx, made.id, false, o), role).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});

describe("listing promos", () => {
  test("newest first, with how often each is in use and what it has given, released uses left out", async () => {
    const { ctx } = await makeUser("manager");
    const made = await createPromo(ctx, fields(), o);
    const customer = await makeUser("customer");
    const live = (await makeOrder(customer.userId, "paid")).orderId;
    const gone = (await makeOrder(customer.userId, "placed")).orderId;
    await admin().query(`insert into promo_redemptions (promo_id, order_id, profile_id, discount_minor) values ($1, $2, $3, 20000), ($1, $4, $3, 30000)`, [made.id, live, customer.userId, gone]);
    await admin().query(`update promo_redemptions set released_at = now() where order_id = $1`, [gone]);

    const list = await listPromos(ctx, o);
    const row = list.find((p) => p.id === made.id)!;
    expect(row).toMatchObject({ redemptions: 1, discountGivenMinor: 20_000 });
    const times = list.map((p) => p.createdAt.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });
});
