import { afterAll, describe, expect, inject, test } from "vitest";
import { restaurantConfig } from "../config/restaurant";
import type { RestaurantConfig } from "../config/schema";
import { closePools } from "../src/db/context";
import { MAX_ATTEMPTS, dispatchQueued, queueDeliveries } from "../src/delivery/dispatch";
import { checkWallet } from "../src/delivery/wallet";
import { MockDeliveryProvider } from "../src/providers/delivery/mock";
import { QuoteExpiredError } from "../src/providers/delivery/types";
import type { OrderStatus } from "../src/domain/orders/statuses";
import { admin, closeFixtures, makeOrder, makeUser } from "./helpers/fixtures";

const urls = inject("dbUrls");
const config = (dispatchOn: RestaurantConfig["delivery"]["dispatchOn"] = "accepted"): RestaurantConfig => ({
  ...restaurantConfig,
  features: { ...restaurantConfig.features, delivery: true },
  delivery: { ...restaurantConfig.delivery, dispatchOn },
});
// Other test files leave deliveries in the shared database, so each run is limited to this test's own orders.
const deps = (provider: MockDeliveryProvider, only: string[], over: Record<string, unknown> = {}) => ({ provider, systemUrl: urls.system, config: config(), now: new Date(Date.now() + 5_000), onlyOrderIds: only, ...over });
afterAll(async () => {
  await closePools();
  await closeFixtures();
});

async function deliveryOrder(status: OrderStatus = "accepted", fulfilment: "delivery" | "pickup" = "delivery") {
  const user = await makeUser("customer");
  const { orderId } = await makeOrder(user.userId, status, fulfilment);
  await admin().query(`update orders set delivery_fee_minor = 150000, customer_name = 'Ada Lovelace', notes = 'ring twice' where id = $1`, [orderId]);
  await admin().query(`insert into order_contacts (order_id, phone, address_snapshot) values ($1, '+2348031112222', '{"zone":"Island","address":"12 Admiralty Way, Lekki","landmark":"Blue gate"}')`, [orderId]);
  const code = (await admin().query(`select public_code from orders where id = $1`, [orderId])).rows[0].public_code as string;
  return { orderId, code };
}
const row = async (orderId: string) =>
  (await admin().query(`select status, provider_ref, quote_id, fee_charged_minor::int as fee, provider_cost_minor::int as cost, tracking_url, attempts, failure_reason, next_attempt_at from deliveries where order_id = $1`, [orderId])).rows[0];
const orderStatus = async (id: string) => (await admin().query(`select status, resume_state from orders where id = $1`, [id])).rows[0];
const alerts = async (orderId: string, kind: string) => (await admin().query(`select 1 from alerts where order_id = $1 and kind = $2 and resolved_at is null`, [orderId, kind])).rowCount;

describe("queueDeliveries", () => {
  test("queues a delivery for an accepted delivery order, once, with the fee the customer paid", async () => {
    const p = new MockDeliveryProvider();
    const o = await deliveryOrder("accepted");
    await queueDeliveries(deps(p, [o.orderId]));
    await queueDeliveries(deps(p, [o.orderId]));
    expect(await row(o.orderId)).toMatchObject({ status: "queued", fee: 150_000, attempts: 0 });
    expect((await admin().query(`select 1 from deliveries where order_id = $1`, [o.orderId])).rowCount).toBe(1);
  });

  test("ignores orders that are unpaid, not yet accepted, or for pickup", async () => {
    const p = new MockDeliveryProvider();
    const a = await deliveryOrder("placed");
    const b = await deliveryOrder("paid");
    const c = await deliveryOrder("accepted", "pickup");
    await queueDeliveries(deps(p, [a.orderId, b.orderId, c.orderId]));
    for (const o of [a, b, c]) expect(await row(o.orderId)).toBeUndefined();
  });

  test("follows config.delivery.dispatchOn", async () => {
    const p = new MockDeliveryProvider();
    const accepted = await deliveryOrder("accepted");
    const preparing = await deliveryOrder("preparing");
    const ready = await deliveryOrder("ready");
    await queueDeliveries(deps(p, [accepted.orderId, preparing.orderId, ready.orderId], { config: config("ready") }));
    expect(await row(accepted.orderId)).toBeUndefined();
    expect(await row(preparing.orderId)).toBeUndefined();
    expect(await row(ready.orderId)).toBeDefined();
  });

  test("never queues a cancelled or finished order", async () => {
    const p = new MockDeliveryProvider();
    const done = await deliveryOrder("cancelled");
    await queueDeliveries(deps(p, [done.orderId]));
    expect(await row(done.orderId)).toBeUndefined();
  });
});

describe("dispatchQueued", () => {
  test("books a rider with a fresh quote, from the restaurant to the customer, and records everything", async () => {
    const p = new MockDeliveryProvider({ feeMinor: 180_000 });
    const o = await deliveryOrder();
    await queueDeliveries(deps(p, [o.orderId]));
    const seen: unknown[] = [];
    const quote = p.getQuote.bind(p);
    p.getQuote = async (i) => (seen.push(i), quote(i));
    const result = await dispatchQueued(deps(p, [o.orderId]));
    expect(result.booked).toBeGreaterThanOrEqual(1);
    const r = await row(o.orderId);
    expect(r).toMatchObject({ status: "pending", attempts: 1, fee: 150_000, cost: 180_000, failure_reason: null });
    expect(r.provider_ref).toBeTruthy();
    expect(r.tracking_url).toContain(r.provider_ref);
    const trip = seen.find((s) => (s as { dropoff: { name: string } }).dropoff.name === "Ada Lovelace") as { pickup: { name: string; phone: string; address: string }; dropoff: { phone: string; address: string } };
    expect(trip.pickup).toMatchObject({ name: restaurantConfig.name, phone: restaurantConfig.contact.phone });
    expect(trip.pickup.address).toContain(restaurantConfig.address.line1);
    expect(trip.dropoff).toMatchObject({ phone: "+2348031112222" });
    expect(trip.dropoff.address).toBe("12 Admiralty Way, Lekki, Island");
  });

  test("the customer's fee and the provider's cost are kept apart, so a difference is visible", async () => {
    const p = new MockDeliveryProvider({ feeMinor: 90_000 });
    const o = await deliveryOrder();
    await queueDeliveries(deps(p, [o.orderId]));
    await dispatchQueued(deps(p, [o.orderId]));
    const r = await row(o.orderId);
    expect(r.fee).toBe(150_000);
    expect(r.cost).toBe(90_000);
  });

  test("a quote that has expired is replaced once, within the same attempt", async () => {
    const p = new MockDeliveryProvider();
    const o = await deliveryOrder();
    await queueDeliveries(deps(p, [o.orderId]));
    const quote = p.getQuote.bind(p);
    let first = true;
    p.getQuote = async (i) => {
      const q = await quote(i);
      if (first) {
        first = false;
        p.expireQuote(q.quoteId);
      }
      return q;
    };
    await dispatchQueued(deps(p, [o.orderId]));
    expect(await row(o.orderId)).toMatchObject({ status: "pending", attempts: 1 });
  });

  test("a provider failure is retried later, with the order and the customer's payment untouched", async () => {
    const p = new MockDeliveryProvider();
    const o = await deliveryOrder();
    await queueDeliveries(deps(p, [o.orderId]));
    p.failNextCreate();
    const now = new Date(Date.now() + 5_000); // ahead of the database-stamped due time
    await dispatchQueued(deps(p, [o.orderId], { now }));
    const r = await row(o.orderId);
    expect(r).toMatchObject({ status: "queued", attempts: 1 });
    expect(r.failure_reason).toMatch(/mock provider failure/);
    expect(new Date(r.next_attempt_at).getTime()).toBeGreaterThan(now.getTime() + 30_000);
    expect((await orderStatus(o.orderId)).status).toBe("accepted");

    await dispatchQueued(deps(p, [o.orderId], { now })); // not due yet
    expect((await row(o.orderId)).attempts).toBe(1);
    await dispatchQueued(deps(p, [o.orderId], { now: new Date(now.getTime() + 10 * 60_000) }));
    expect(await row(o.orderId)).toMatchObject({ status: "pending", attempts: 2 });
  });

  test("after the last attempt the order becomes delivery_failed, once, with an alert for a manager", async () => {
    const p = new MockDeliveryProvider();
    const o = await deliveryOrder();
    await queueDeliveries(deps(p, [o.orderId]));
    let when = new Date(Date.now() + 5_000);
    for (let i = 0; i < MAX_ATTEMPTS + 2; i++) {
      p.failNextCreate();
      await dispatchQueued(deps(p, [o.orderId], { now: when }));
      when = new Date(when.getTime() + 60 * 60_000);
    }
    expect(await row(o.orderId)).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS });
    expect(await orderStatus(o.orderId)).toEqual({ status: "delivery_failed", resume_state: "accepted" });
    expect(await alerts(o.orderId, "delivery_failed")).toBe(1);
    expect((await admin().query(`select actor_type from order_events where order_id = $1 and to_status = 'delivery_failed'`, [o.orderId])).rows).toEqual([{ actor_type: "system" }]);
  });

  test("an empty delivery wallet raises one wallet alert and keeps trying", async () => {
    const p = new MockDeliveryProvider({ walletMinor: 0 });
    const o = await deliveryOrder();
    // The wallet alert is shared (it has no order), so start from none open.
    await admin().query(`update alerts set resolved_at = now() where kind = 'wallet_low' and resolved_at is null`);
    await queueDeliveries(deps(p, [o.orderId]));
    let when = new Date(Date.now() + 5_000);
    for (let i = 0; i < 2; i++) {
      await dispatchQueued(deps(p, [o.orderId], { now: when }));
      when = new Date(when.getTime() + 60 * 60_000);
    }
    expect(await row(o.orderId)).toMatchObject({ status: "queued", attempts: 2 });
    const walletAlerts = (await admin().query(`select count(*)::int as n from alerts where kind = 'wallet_low' and resolved_at is null`)).rows[0].n;
    expect(walletAlerts).toBe(1);
    p.setWalletBalance(10_000_000);
    await dispatchQueued(deps(p, [o.orderId], { now: when }));
    expect((await row(o.orderId)).status).toBe("pending");
  });

  test("an order cancelled before the rider was booked is never booked", async () => {
    const p = new MockDeliveryProvider();
    const o = await deliveryOrder();
    await queueDeliveries(deps(p, [o.orderId]));
    await admin().query(`update orders set status = 'cancelled' where id = $1`, [o.orderId]);
    await dispatchQueued(deps(p, [o.orderId]));
    expect((await row(o.orderId)).status).toBe("cancelled");
    expect(p.created).toEqual([]);
  });

  test("two workers at once book one rider", async () => {
    const p = new MockDeliveryProvider();
    const o = await deliveryOrder();
    await queueDeliveries(deps(p, [o.orderId]));
    await Promise.all([dispatchQueued(deps(p, [o.orderId])), dispatchQueued(deps(p, [o.orderId]))]);
    expect(p.created.filter((r) => r.startsWith(o.code))).toHaveLength(1);
    expect((await row(o.orderId)).status).toBe("pending");
  });

  test("a booking that reached the provider but was never recorded is adopted, not booked twice", async () => {
    const p = new MockDeliveryProvider();
    const o = await deliveryOrder();
    await queueDeliveries(deps(p, [o.orderId]));
    // Simulate a crash after the provider accepted the booking: it knows the reference, our row does not.
    const q = await p.getQuote({ pickup: { name: "r", phone: "1", address: "a" }, dropoff: { name: "c", phone: "2", address: "b" } });
    await p.createDelivery({ pickup: { name: "r", phone: "1", address: "a" }, dropoff: { name: "c", phone: "2", address: "b" }, quoteId: q.quoteId, reference: `${o.code}-1-1` });
    await dispatchQueued(deps(p, [o.orderId]));
    expect(p.created.filter((r) => r.startsWith(o.code))).toHaveLength(1);
    const r = await row(o.orderId);
    expect(r.status).toBe("pending");
    expect(r.provider_ref).toBeTruthy();
  });

  test("the quote error type is recognisable", () => {
    expect(new QuoteExpiredError("x")).toBeInstanceOf(Error);
  });
});

describe("checkWallet", () => {
  const openWalletAlerts = async () => (await admin().query(`select count(*)::int as n from alerts where kind = 'wallet_low' and resolved_at is null`)).rows[0].n as number;
  const reset = () => admin().query(`update alerts set resolved_at = now() where kind = 'wallet_low' and resolved_at is null`);
  const low = restaurantConfig.delivery.lowWalletMinor;
  const run = (p: MockDeliveryProvider) => checkWallet({ provider: p, systemUrl: urls.system, config: config() });

  test("a low balance raises one alert however often it is checked, and is recorded each time", async () => {
    await reset();
    const p = new MockDeliveryProvider({ walletMinor: low - 1 });
    const before = (await admin().query(`select count(*)::int as n from wallet_snapshots`)).rows[0].n as number;
    expect(await run(p)).toEqual({ checked: true, balanceMinor: low - 1, low: true });
    await run(p);
    expect(await openWalletAlerts()).toBe(1);
    expect((await admin().query(`select count(*)::int as n from wallet_snapshots`)).rows[0].n as number).toBe(before + 2);
  });

  test("a balance at the threshold is healthy and closes the alert", async () => {
    await reset();
    await run(new MockDeliveryProvider({ walletMinor: 0 }));
    expect(await openWalletAlerts()).toBe(1);
    expect(await run(new MockDeliveryProvider({ walletMinor: low }))).toMatchObject({ checked: true, low: false });
    expect(await openWalletAlerts()).toBe(0);
  });

  test("when the provider cannot be reached nothing changes and no alert is raised or closed", async () => {
    await reset();
    await run(new MockDeliveryProvider({ walletMinor: 0 }));
    const p = new MockDeliveryProvider({ walletMinor: 10_000_000 });
    p.getWalletBalance = async () => {
      throw new Error("provider down");
    };
    expect(await run(p)).toEqual({ checked: false });
    expect(await openWalletAlerts()).toBe(1);
  });

  test("nothing is checked when delivery is switched off", async () => {
    await reset();
    const off = { ...config(), features: { ...restaurantConfig.features, delivery: false } };
    expect(await checkWallet({ provider: new MockDeliveryProvider({ walletMinor: 0 }), systemUrl: urls.system, config: off })).toEqual({ checked: false });
    expect(await openWalletAlerts()).toBe(0);
  });
});
