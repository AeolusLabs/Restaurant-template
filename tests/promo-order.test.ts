import { afterAll, beforeAll, describe, expect, inject, test } from "vitest";
import { restaurantConfig } from "../config/restaurant";
import type { RestaurantConfig } from "../config/schema";
import { closePools } from "../src/db/context";
import { createDeliveryOrder, createPickupOrder } from "../src/db/orders";
import { transitionOrder } from "../src/db/transition-order";
import { pickupSlots } from "../src/domain/pickup/slots";
import { admin, closeFixtures, makeUser } from "./helpers/fixtures";

const urls = inject("dbUrls");
const tag = `po${Date.now().toString(36)}`;
const NOW = new Date();
const allDay = { open: "00:00", close: "23:59" };
const config: RestaurantConfig = {
  ...restaurantConfig,
  features: { ...restaurantConfig.features, delivery: true, pickup: true, promos: true },
  openingHours: { mon: [allDay], tue: [allDay], wed: [allDay], thu: [allDay], fri: [allDay], sat: [allDay], sun: [allDay] },
  charges: { serviceChargeBps: 500, taxBps: 750, pricesIncludeCharges: false },
  delivery: { ...restaurantConfig.delivery, zones: [{ name: "Island", feeMinor: 150_000 }] },
};
const deps = (over: Record<string, unknown> = {}) => ({ now: NOW, config, appUrl: urls.app, ...over });
const slot = pickupSlots(NOW, config)[3];

let itemId: string;
beforeAll(async () => {
  const cat = (await admin().query(`insert into menu_categories (slug, name) values ($1, 'Promo test') returning id`, [`${tag}-cat`])).rows[0].id;
  itemId = (await admin().query(`insert into menu_items (category_id, slug, name, price_minor) values ($1, $2, 'Rice', 100000) returning id`, [cat, `${tag}-rice`])).rows[0].id;
});
afterAll(async () => {
  await closePools();
  await closeFixtures();
});

let n = 0;
const code = () => `P${Date.now().toString(36)}${++n}`.toUpperCase().slice(0, 20);
type PromoOpts = { kind?: string; value?: number | null; min?: number; cap?: number | null; starts?: string | null; expires?: string | null; max?: number | null; perCustomer?: number | null; active?: boolean };
async function promo(o: PromoOpts = {}) {
  const c = code();
  const kind = o.kind ?? "percent";
  const value = o.value === undefined ? (kind === "free_delivery" ? null : 1000) : o.value;
  const { rows } = await admin().query(
    `insert into promos (code, kind, value, min_order_minor, max_discount_minor, starts_at, expires_at, max_redemptions, max_per_customer, active)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
    [c, kind, value, o.min ?? 0, o.cap ?? null, o.starts ?? null, o.expires ?? null, o.max ?? null, o.perCustomer === undefined ? 1 : o.perCustomer, o.active ?? true],
  );
  return { id: rows[0].id as string, code: c };
}
const customer = async () => (await makeUser("customer")).ctx;
const lines = (quantity = 2) => [{ itemId, quantity, modifierIds: [] }];
const delivery = (over: Record<string, unknown> = {}) => ({
  lines: lines(),
  zone: "Island",
  address: "12 Admiralty Way, Lekki",
  phone: "+234 803 000 0000",
  checkoutToken: `${tag}-d-${++n}`,
  ...over,
});
const pickup = (over: Record<string, unknown> = {}) => ({ lines: lines(), pickupAt: slot, phone: "+234 803 000 0000", checkoutToken: `${tag}-p-${++n}`, ...over });
const redemptions = async (promoId: string) => (await admin().query(`select order_id, profile_id, discount_minor::int as d, released_at from promo_redemptions where promo_id = $1`, [promoId])).rows;

describe("placing an order with a promo", () => {
  test("a percentage comes off the items, charges follow the discounted items, and the fee is added after", async () => {
    const p = await promo({ value: 1000 });
    const { order } = await createDeliveryOrder(await customer(), delivery({ promoCode: p.code }), deps());
    // items 200,000, 10% off = 20,000; service 5% of 180,000 = 9,000; tax 7.5% of 189,000 = 14,175; plus 150,000 delivery.
    expect(order).toMatchObject({ subtotalMinor: 200_000, discountMinor: 20_000, serviceChargeMinor: 9_000, taxMinor: 14_175, deliveryFeeMinor: 150_000, totalMinor: 353_175, promoId: p.id });
    const rows = await redemptions(p.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ order_id: order.id, d: 20_000, released_at: null });
  });

  test("a fixed amount works on a pickup order, and the code can be typed in any case", async () => {
    const p = await promo({ kind: "fixed", value: 50_000 });
    const { order } = await createPickupOrder(await customer(), pickup({ promoCode: ` ${p.code.toLowerCase()} ` }), deps());
    expect(order).toMatchObject({ subtotalMinor: 200_000, discountMinor: 50_000, promoId: p.id });
  });

  test("free delivery waives the fee, records what it cost, and leaves the items alone", async () => {
    const p = await promo({ kind: "free_delivery" });
    const { order } = await createDeliveryOrder(await customer(), delivery({ promoCode: p.code }), deps());
    expect(order).toMatchObject({ deliveryFeeMinor: 0, discountMinor: 0, totalMinor: 225_750, promoId: p.id });
    expect((await redemptions(p.id))[0].d).toBe(150_000);
  });

  test("an order with no code is priced as before and records no redemption", async () => {
    const { order } = await createDeliveryOrder(await customer(), delivery(), deps());
    expect(order).toMatchObject({ discountMinor: 0, promoId: null, totalMinor: 375_750 });
    expect((await admin().query(`select 1 from promo_redemptions where order_id = $1`, [order.id])).rowCount).toBe(0);
  });

  test("the total the customer saw, with the code, must still be the total", async () => {
    const p = await promo({ value: 1000 });
    const ctx = await customer();
    await expect(createDeliveryOrder(ctx, delivery({ promoCode: p.code, expectedTotalMinor: 375_750 }), deps())).rejects.toMatchObject({ code: "price_changed" });
    expect((await redemptions(p.id)).length).toBe(0);
    const ok = await createDeliveryOrder(ctx, delivery({ promoCode: p.code, expectedTotalMinor: 353_175 }), deps());
    expect(ok.order.totalMinor).toBe(353_175);
  });

  test("a second submit with the same token returns the same order and uses the promo once", async () => {
    const p = await promo({ perCustomer: 5 });
    const ctx = await customer();
    const body = delivery({ promoCode: p.code, checkoutToken: `${tag}-same-${n}` });
    const a = await createDeliveryOrder(ctx, body, deps());
    const b = await createDeliveryOrder(ctx, body, deps());
    expect(b.created).toBe(false);
    expect(b.order.id).toBe(a.order.id);
    expect(await redemptions(p.id)).toHaveLength(1);
  });
});

describe("a promo that cannot be used", () => {
  const reason = (ctx: Awaited<ReturnType<typeof customer>>, input: Record<string, unknown>, d = deps()) =>
    createDeliveryOrder(ctx, input as never, d).then(
      () => "accepted",
      (e) => (e.code === "promo_invalid" ? e.promoReason : `other:${e.code}`),
    );

  test("an unknown code, a malformed one, and one used when promos are switched off", async () => {
    const ctx = await customer();
    expect(await reason(ctx, delivery({ promoCode: "NOSUCHCODE" }))).toBe("unknown");
    expect(await reason(ctx, delivery({ promoCode: "x y" }))).toBe("unknown");
    const p = await promo();
    const off = { ...config, features: { ...config.features, promos: false } };
    expect(await reason(ctx, delivery({ promoCode: p.code }), deps({ config: off }))).toBe("disabled");
  });

  test("switched off, not yet started, and expired", async () => {
    const ctx = await customer();
    expect(await reason(ctx, delivery({ promoCode: (await promo({ active: false })).code }))).toBe("inactive");
    expect(await reason(ctx, delivery({ promoCode: (await promo({ starts: new Date(NOW.getTime() + 86_400_000).toISOString() })).code }))).toBe("not_started");
    expect(await reason(ctx, delivery({ promoCode: (await promo({ expires: new Date(NOW.getTime() - 1000).toISOString() })).code }))).toBe("expired");
  });

  test("below the minimum order, measured on the items", async () => {
    const p = await promo({ min: 200_001 });
    expect(await reason(await customer(), delivery({ promoCode: p.code }))).toBe("below_minimum");
    const ok = await promo({ min: 200_000 });
    expect(await reason(await customer(), delivery({ promoCode: ok.code }))).toBe("accepted");
  });

  test("free delivery on a pickup order", async () => {
    const p = await promo({ kind: "free_delivery" });
    await expect(createPickupOrder(await customer(), pickup({ promoCode: p.code }), deps())).rejects.toMatchObject({ code: "promo_invalid", promoReason: "delivery_only" });
  });

  test("a promo that would make the order free", async () => {
    const p = await promo({ kind: "fixed", value: 9_000_000 });
    expect(await reason(await customer(), delivery({ promoCode: p.code, lines: lines(1) }))).toBe("accepted"); // the fee still has to be paid
    await expect(createPickupOrder(await customer(), pickup({ promoCode: p.code }), deps())).rejects.toMatchObject({ code: "promo_invalid", promoReason: "free_order" });
  });

  test("a refused promo leaves no order and no redemption behind", async () => {
    const ctx = await customer();
    const p = await promo({ min: 99_999_999 });
    await reason(ctx, delivery({ promoCode: p.code }));
    expect((await admin().query(`select 1 from orders where profile_id = $1`, [ctx.userId])).rowCount).toBe(0);
    expect(await redemptions(p.id)).toHaveLength(0);
  });
});

describe("promo limits", () => {
  test("once per customer by default: the same person cannot use it twice, someone else can", async () => {
    const p = await promo();
    const a = await customer();
    await createDeliveryOrder(a, delivery({ promoCode: p.code }), deps());
    await expect(createDeliveryOrder(a, delivery({ promoCode: p.code }), deps())).rejects.toMatchObject({ code: "promo_invalid", promoReason: "already_used" });
    await createDeliveryOrder(await customer(), delivery({ promoCode: p.code }), deps());
    expect(await redemptions(p.id)).toHaveLength(2);
  });

  test("a total limit is used up for everyone", async () => {
    const p = await promo({ max: 2, perCustomer: null });
    await createDeliveryOrder(await customer(), delivery({ promoCode: p.code }), deps());
    await createDeliveryOrder(await customer(), delivery({ promoCode: p.code }), deps());
    await expect(createDeliveryOrder(await customer(), delivery({ promoCode: p.code }), deps())).rejects.toMatchObject({ promoReason: "used_up" });
  });

  test("two customers racing for the last use: exactly one gets it", async () => {
    const p = await promo({ max: 1, perCustomer: null });
    const [a, b] = [await customer(), await customer()];
    const results = await Promise.allSettled([createDeliveryOrder(a, delivery({ promoCode: p.code }), deps()), createDeliveryOrder(b, delivery({ promoCode: p.code }), deps())]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason).toMatchObject({ code: "promo_invalid", promoReason: "used_up" });
    expect(await redemptions(p.id)).toHaveLength(1);
  });

  test("the same customer double-clicking with two tokens still uses a once-only code once", async () => {
    const p = await promo({ perCustomer: 1 });
    const a = await customer();
    const results = await Promise.allSettled([createDeliveryOrder(a, delivery({ promoCode: p.code }), deps()), createDeliveryOrder(a, delivery({ promoCode: p.code }), deps())]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await redemptions(p.id)).toHaveLength(1);
  });

  test("an order that expires unpaid gives the use back, so the next customer can have it", async () => {
    const p = await promo({ max: 1, perCustomer: null });
    const first = await createDeliveryOrder(await customer(), delivery({ promoCode: p.code }), deps());
    await expect(createDeliveryOrder(await customer(), delivery({ promoCode: p.code }), deps())).rejects.toMatchObject({ promoReason: "used_up" });
    await transitionOrder({ orderId: first.order.id, to: "cancelled", actor: { type: "system" }, expectedFrom: "placed", reason: "expired" }, { systemUrl: urls.system });
    const second = await createDeliveryOrder(await customer(), delivery({ promoCode: p.code }), deps());
    expect(second.created).toBe(true);
    expect((await redemptions(p.id)).filter((r) => r.released_at === null)).toHaveLength(1);
  });

  test("changing a promo afterwards does not change the order that used it", async () => {
    const p = await promo({ value: 1000 });
    const { order } = await createDeliveryOrder(await customer(), delivery({ promoCode: p.code }), deps());
    await admin().query(`update promos set value = 5000, active = false where id = $1`, [p.id]);
    const stored = (await admin().query(`select discount_minor::int as d, total_minor::int as t from orders where id = $1`, [order.id])).rows[0];
    expect(stored).toEqual({ d: 20_000, t: 353_175 });
  });
});
