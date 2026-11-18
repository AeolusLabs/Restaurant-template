import { afterAll, describe, expect, inject, test } from "vitest";
import { ForbiddenError } from "../src/auth/session";
import { closePools } from "../src/db/context";
import { loadDashboard } from "../src/db/dashboard";
import { admin, closeFixtures, makeOrder, makeUser } from "./helpers/fixtures";

const urls = inject("dbUrls");
const o = { url: urls.app };
const LAGOS = "Africa/Lagos"; // UTC+1
afterAll(async () => {
  await closePools();
  await closeFixtures();
});

// Every test works in its own year, so its window holds only its own data and shares nothing with other tests.
let yearCounter = 2000;
const newYear = () => {
  const y = ++yearCounter;
  return { y, now: new Date(`${y}-06-15T12:00:00Z`), at: (day: string, time = "10:00:00") => new Date(`${y}-${day}T${time}Z`) };
};
const load = async (now: Date, days: 7 | 30 | 90 = 7) => loadDashboard((await makeUser("manager")).ctx, { days, now, timeZone: LAGOS }, o);

type Sale = {
  profileId: string;
  paidAt: Date;
  totalMinor: number;
  fulfilment?: "pickup" | "delivery";
  paymentStatus?: "succeeded" | "refunded";
  /** Defaults to completed. */
  orderStatus?: "completed" | "cancelled";
  items?: { name: string; quantity: number; lineTotalMinor: number }[];
  delivery?: { feeMinor: number; costMinor: number | null; status?: string };
  promo?: { code: string; discountMinor: number; released?: boolean };
};
async function sale(s: Sale): Promise<string> {
  const { orderId } = await makeOrder(s.profileId, s.orderStatus ?? "completed", s.fulfilment ?? "pickup");
  await admin().query(`update orders set total_minor = $2, placed_at = $3 where id = $1`, [orderId, s.totalMinor, s.paidAt]);
  await admin().query(`insert into payments (order_id, provider, reference, amount_minor, currency, status, paid_at) values ($1, 'mock', $2, $3, 'NGN', $4, $5)`, [orderId, `pay-${orderId}`, s.totalMinor, s.paymentStatus ?? "succeeded", s.paidAt]);
  for (const i of s.items ?? []) {
    await admin().query(`insert into order_items (order_id, name_snapshot, unit_price_minor_snapshot, quantity, line_total_minor) values ($1, $2, $3, $4, $5)`, [orderId, i.name, Math.round(i.lineTotalMinor / i.quantity), i.quantity, i.lineTotalMinor]);
  }
  if (s.delivery) {
    await admin().query(`insert into deliveries (order_id, provider, status, fee_charged_minor, provider_cost_minor, provider_ref) values ($1, 'mock', $2, $3, $4, $5)`, [orderId, s.delivery.status ?? "delivered", s.delivery.feeMinor, s.delivery.costMinor, s.delivery.costMinor === null ? null : `ref-${orderId}`]);
  }
  if (s.promo) {
    const promoId = (await admin().query(`insert into promos (code, kind, value) values ($1, 'fixed', 1000) returning id`, [`${s.promo.code}${orderId.slice(-6)}`.toUpperCase().slice(0, 20)])).rows[0].id;
    await admin().query(`insert into promo_redemptions (promo_id, order_id, profile_id, discount_minor, released_at) values ($1, $2, $3, $4, $5)`, [promoId, orderId, s.profileId, s.promo.discountMinor, s.promo.released ? new Date() : null]);
  }
  return orderId;
}
const customer = async () => (await makeUser("customer")).userId;

describe("sales", () => {
  test("totals the paid orders in the window, and the same number of days before it for comparison", async () => {
    const { at, now } = newYear();
    const c = await customer();
    await sale({ profileId: c, paidAt: at("06-10"), totalMinor: 300_000 });
    await sale({ profileId: c, paidAt: at("06-12"), totalMinor: 200_000 });
    await sale({ profileId: c, paidAt: at("06-05"), totalMinor: 100_000 }); // the week before
    const d = await load(now);
    expect(d.sales).toMatchObject({ salesMinor: 500_000, orders: 2, prevSalesMinor: 100_000, prevOrders: 1 });
  });

  test("a payment before the window or after now is not in it", async () => {
    const { at, now } = newYear();
    const c = await customer();
    await sale({ profileId: c, paidAt: at("06-08", "22:59:59"), totalMinor: 111 }); // 23:59 on the 8th in Lagos: before the window starts
    await sale({ profileId: c, paidAt: at("06-08", "23:00:00"), totalMinor: 222 }); // midnight on the 9th: the first moment in it
    await sale({ profileId: c, paidAt: at("06-15", "12:00:01"), totalMinor: 999 }); // after now
    expect((await load(now)).sales).toMatchObject({ salesMinor: 222, orders: 1 });
  });

  test("a cancelled order whose refund has not gone through yet is not sales, and is not yet refunded either", async () => {
    const { at, now } = newYear();
    const c = await customer();
    await sale({ profileId: c, paidAt: at("06-10"), totalMinor: 300_000 });
    await sale({ profileId: c, paidAt: at("06-11"), totalMinor: 400_000, orderStatus: "cancelled" }); // payment still "succeeded": the refund failed
    expect((await load(now)).sales).toMatchObject({ salesMinor: 300_000, orders: 1, refundedMinor: 0, refundedOrders: 0 });
  });

  test("a refunded order is not sales, and is counted as refunded", async () => {
    const { at, now } = newYear();
    const c = await customer();
    await sale({ profileId: c, paidAt: at("06-10"), totalMinor: 300_000 });
    await sale({ profileId: c, paidAt: at("06-11"), totalMinor: 400_000, paymentStatus: "refunded" });
    expect((await load(now)).sales).toMatchObject({ salesMinor: 300_000, orders: 1, refundedMinor: 400_000, refundedOrders: 1 });
  });

  test("every day in the window is listed, empty days as zero, bucketed by the restaurant's day", async () => {
    const { at, now } = newYear();
    const c = await customer();
    await sale({ profileId: c, paidAt: at("06-12", "23:30:00"), totalMinor: 100_000 }); // 00:30 on the 13th in Lagos
    await sale({ profileId: c, paidAt: at("06-13", "09:00:00"), totalMinor: 50_000 });
    const d = await load(now);
    expect(d.daily).toHaveLength(7);
    expect(d.daily.map((x) => x.key)[0]).toBe(`${now.getUTCFullYear()}-06-09`);
    const byKey = Object.fromEntries(d.daily.map((x) => [x.key, x]));
    expect(byKey[`${now.getUTCFullYear()}-06-13`]).toMatchObject({ salesMinor: 150_000, orders: 2 });
    expect(byKey[`${now.getUTCFullYear()}-06-12`]).toMatchObject({ salesMinor: 0, orders: 0 });
  });

  test("an empty period is zeros and empty lists, not an error", async () => {
    const { now } = newYear();
    const d = await load(now, 30);
    expect(d.sales).toEqual({ salesMinor: 0, orders: 0, refundedMinor: 0, refundedOrders: 0, prevSalesMinor: 0, prevOrders: 0 });
    expect(d.daily).toHaveLength(30);
    expect(d.hours).toEqual([]);
    expect(d.topItems).toEqual([]);
    expect(d.customers).toEqual({ newCustomers: 0, returning: 0 });
    expect(d.delivery).toMatchObject({ deliveries: 0 });
  });
});

describe("peak hours", () => {
  test("counts orders by the restaurant's weekday and hour (Monday is 1)", async () => {
    const { at, now } = newYear();
    const c = await customer();
    // 2002-06-10 is a Monday. 17:30Z is 18:30 in Lagos.
    const monday = new Date(Date.UTC(now.getUTCFullYear(), 5, 10, 17, 30)).getUTCDay();
    expect(monday).toBe(new Date(`${now.getUTCFullYear()}-06-10T00:00:00Z`).getUTCDay());
    await sale({ profileId: c, paidAt: at("06-10", "17:30:00"), totalMinor: 1 });
    await sale({ profileId: c, paidAt: at("06-10", "17:50:00"), totalMinor: 1 });
    await sale({ profileId: c, paidAt: at("06-11", "23:15:00"), totalMinor: 1 }); // 00:15 the next day in Lagos
    const d = await load(now);
    const isoDay = (m: number, day: number) => ((new Date(Date.UTC(now.getUTCFullYear(), m, day)).getUTCDay() + 6) % 7) + 1;
    expect(d.hours).toContainEqual({ weekday: isoDay(5, 10), hour: 18, orders: 2 });
    expect(d.hours).toContainEqual({ weekday: isoDay(5, 12), hour: 0, orders: 1 });
    expect(d.hours.reduce((n, c2) => n + c2.orders, 0)).toBe(3);
  });
});

describe("customers", () => {
  test("new when their first paid order is in the window, returning when they ordered before it", async () => {
    const { at, now, y } = newYear();
    const fresh = await customer();
    const regular = await customer();
    const lapsed = await customer();
    await sale({ profileId: fresh, paidAt: at("06-10"), totalMinor: 1 });
    await sale({ profileId: regular, paidAt: at("01-05"), totalMinor: 1 }); // months ago
    await sale({ profileId: regular, paidAt: at("06-11"), totalMinor: 1 });
    await sale({ profileId: regular, paidAt: at("06-12"), totalMinor: 1 }); // twice in the window, still one customer
    await sale({ profileId: lapsed, paidAt: at("06-01"), totalMinor: 1 }); // before the window: not counted at all
    expect(y).toBeGreaterThan(2000);
    expect((await load(now)).customers).toEqual({ newCustomers: 1, returning: 1 });
  });

  test("someone whose earlier order was refunded has still ordered before, so they are returning", async () => {
    const { at, now } = newYear();
    const c = await customer();
    await sale({ profileId: c, paidAt: at("02-10"), totalMinor: 1, paymentStatus: "refunded" });
    await sale({ profileId: c, paidAt: at("06-10"), totalMinor: 1 });
    expect((await load(now)).customers).toEqual({ newCustomers: 0, returning: 1 });
  });
});

describe("pickup and delivery, best sellers, promos", () => {
  test("splits sales between pickup and delivery", async () => {
    const { at, now } = newYear();
    const c = await customer();
    await sale({ profileId: c, paidAt: at("06-10"), totalMinor: 300_000, fulfilment: "pickup" });
    await sale({ profileId: c, paidAt: at("06-11"), totalMinor: 500_000, fulfilment: "delivery" });
    await sale({ profileId: c, paidAt: at("06-12"), totalMinor: 100_000, fulfilment: "delivery" });
    expect((await load(now)).fulfilment).toEqual({ pickup: { orders: 1, salesMinor: 300_000 }, delivery: { orders: 2, salesMinor: 600_000 } });
  });

  test("best sellers are by quantity, ties by sales, five at most, grouped by the name on the order", async () => {
    const { at, now } = newYear();
    const c = await customer();
    await sale({ profileId: c, paidAt: at("06-10"), totalMinor: 1, items: [{ name: "Jollof", quantity: 3, lineTotalMinor: 300_000 }, { name: "Zobo", quantity: 1, lineTotalMinor: 50_000 }] });
    await sale({ profileId: c, paidAt: at("06-11"), totalMinor: 1, items: [{ name: "Jollof", quantity: 2, lineTotalMinor: 200_000 }, { name: "Fried rice", quantity: 5, lineTotalMinor: 100_000 }] });
    for (const n of ["A", "B", "C", "D"]) await sale({ profileId: c, paidAt: at("06-12"), totalMinor: 1, items: [{ name: `Extra ${n}`, quantity: 1, lineTotalMinor: 10_000 }] });
    const top = (await load(now)).topItems;
    expect(top).toHaveLength(5);
    expect(top.slice(0, 2)).toEqual([
      { name: "Jollof", quantity: 5, salesMinor: 500_000 },
      { name: "Fried rice", quantity: 5, salesMinor: 100_000 },
    ]);
  });

  test("items on a refunded order are not best sellers", async () => {
    const { at, now } = newYear();
    const c = await customer();
    await sale({ profileId: c, paidAt: at("06-10"), totalMinor: 1, paymentStatus: "refunded", items: [{ name: "Ghost", quantity: 9, lineTotalMinor: 900_000 }] });
    expect((await load(now)).topItems).toEqual([]);
  });

  test("promos: what the codes took off sold orders, leaving out uses that were given back", async () => {
    const { at, now } = newYear();
    const c = await customer();
    await sale({ profileId: c, paidAt: at("06-10"), totalMinor: 1, promo: { code: "A", discountMinor: 30_000 } });
    await sale({ profileId: c, paidAt: at("06-11"), totalMinor: 1, promo: { code: "B", discountMinor: 20_000 } });
    await sale({ profileId: c, paidAt: at("06-12"), totalMinor: 1, promo: { code: "C", discountMinor: 99_000, released: true } });
    expect((await load(now)).promos).toEqual({ orders: 2, discountMinor: 50_000 });
  });
});

describe("delivery against what customers paid for it", () => {
  test("adds up the fees customers paid and what the riders cost, and counts the free ones", async () => {
    const { at, now } = newYear();
    const c = await customer();
    await sale({ profileId: c, paidAt: at("06-10"), totalMinor: 1, fulfilment: "delivery", delivery: { feeMinor: 150_000, costMinor: 140_000 } });
    await sale({ profileId: c, paidAt: at("06-11"), totalMinor: 1, fulfilment: "delivery", delivery: { feeMinor: 0, costMinor: 160_000 } }); // free delivery promo
    await sale({ profileId: c, paidAt: at("06-12"), totalMinor: 1, fulfilment: "delivery", delivery: { feeMinor: 250_000, costMinor: 300_000 } });
    expect((await load(now)).delivery).toEqual({ deliveries: 3, collectedMinor: 400_000, costMinor: 600_000, freeDeliveries: 1 });
  });

  test("leaves out deliveries with no rider cost yet, and ones the provider cancelled or never booked", async () => {
    const { at, now } = newYear();
    const c = await customer();
    await sale({ profileId: c, paidAt: at("06-10"), totalMinor: 1, fulfilment: "delivery", delivery: { feeMinor: 150_000, costMinor: null, status: "queued" } });
    await sale({ profileId: c, paidAt: at("06-11"), totalMinor: 1, fulfilment: "delivery", delivery: { feeMinor: 150_000, costMinor: 100_000, status: "cancelled" } });
    await sale({ profileId: c, paidAt: at("06-12"), totalMinor: 1, fulfilment: "delivery", delivery: { feeMinor: 150_000, costMinor: 100_000, status: "failed" } });
    await sale({ profileId: c, paidAt: at("06-13"), totalMinor: 1, fulfilment: "delivery", delivery: { feeMinor: 150_000, costMinor: 120_000, status: "in_transit" } });
    expect((await load(now)).delivery).toMatchObject({ deliveries: 1, collectedMinor: 150_000, costMinor: 120_000 });
  });
});

describe("who can look", () => {
  test("managers and owners can; the kitchen and customers cannot", async () => {
    const { now } = newYear();
    for (const role of ["manager", "owner"] as const) {
      await expect(loadDashboard((await makeUser(role)).ctx, { days: 7, now, timeZone: LAGOS }, o), role).resolves.toBeDefined();
    }
    for (const role of ["kitchen", "customer"] as const) {
      await expect(loadDashboard((await makeUser(role)).ctx, { days: 7, now, timeZone: LAGOS }, o), role).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});
