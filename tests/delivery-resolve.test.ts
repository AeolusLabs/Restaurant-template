import { afterAll, describe, expect, inject, test } from "vitest";
import { restaurantConfig } from "../config/restaurant";
import type { RestaurantConfig } from "../config/schema";
import { ForbiddenError } from "../src/auth/session";
import { closePools } from "../src/db/context";
import { MAX_ATTEMPTS, dispatchQueued, queueDeliveries } from "../src/delivery/dispatch";
import { DeliveryError, retryDelivery } from "../src/delivery/resolve";
import { syncDeliveries } from "../src/delivery/sync";
import { cancelAndRefund } from "../src/payments/refund";
import { MockDeliveryProvider } from "../src/providers/delivery/mock";
import { MockPaymentProvider } from "../src/providers/payment/mock";
import type { OrderStatus } from "../src/domain/orders/statuses";
import { admin, closeFixtures, makeOrder, makeUser } from "./helpers/fixtures";

const urls = inject("dbUrls");
const config: RestaurantConfig = { ...restaurantConfig, features: { ...restaurantConfig.features, delivery: true } };
afterAll(async () => {
  await closePools();
  await closeFixtures();
});
const ahead = () => new Date(Date.now() + 5_000);

async function setup(status: OrderStatus = "accepted") {
  const delivery = new MockDeliveryProvider();
  const payment = new MockPaymentProvider();
  const user = await makeUser("customer");
  const { orderId } = await makeOrder(user.userId, status, "delivery");
  await admin().query(`update orders set delivery_fee_minor = 150000, total_minor = 400000 where id = $1`, [orderId]);
  await admin().query(`insert into order_contacts (order_id, phone, address_snapshot) values ($1, '+2348031112222', '{"zone":"Island","address":"1 Test Road"}')`, [orderId]);
  await admin().query(`insert into payments (order_id, provider, reference, amount_minor, currency, status) values ($1, 'mock', $2, 400000, 'NGN', 'succeeded')`, [orderId, `pay-${orderId}`]);
  const code = (await admin().query(`select public_code from orders where id = $1`, [orderId])).rows[0].public_code as string;
  // d(): for the delivery code (its provider is the delivery provider). r(): for refunds (its provider is the payment provider).
  const d = (over: Record<string, unknown> = {}) => ({ provider: delivery, systemUrl: urls.system, appUrl: urls.app, config, onlyOrderIds: [orderId], now: ahead(), ...over });
  const r = () => ({ provider: payment, deliveryProvider: delivery, systemUrl: urls.system, appUrl: urls.app });
  return { delivery, payment, orderId, code, d, r };
}
const row = async (orderId: string) => (await admin().query(`select status, provider_ref, attempts, round, failure_reason from deliveries where order_id = $1`, [orderId])).rows[0];
const order = async (id: string) => (await admin().query(`select status, resume_state from orders where id = $1`, [id])).rows[0];
const alertCount = async (orderId: string, kind: string) => (await admin().query(`select count(*)::int as n from alerts where order_id = $1 and kind = $2 and resolved_at is null`, [orderId, kind])).rows[0].n as number;

/** Fails booking until the order becomes delivery_failed, as the dispatch code does. */
async function failed() {
  const s = await setup("accepted");
  await queueDeliveries(s.d());
  let when = Date.now() + 5_000;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    s.delivery.failNextCreate();
    await dispatchQueued(s.d({ now: new Date(when) }));
    when += 60 * 60_000;
  }
  expect((await order(s.orderId)).status).toBe("delivery_failed");
  return s;
}

describe("retryDelivery", () => {
  test("puts the order back where it was, books a new rider, and closes the alert", async () => {
    const s = await failed();
    const { ctx } = await makeUser("manager");
    await retryDelivery(ctx, s.code, s.d());
    expect(await order(s.orderId)).toEqual({ status: "accepted", resume_state: null });
    expect(await row(s.orderId)).toMatchObject({ status: "pending", round: 2, attempts: 1, failure_reason: null });
    expect(s.delivery.created.at(-1)).toBe(`${s.code}-2-1`);
    expect(await alertCount(s.orderId, "delivery_failed")).toBe(0);
    expect((await admin().query(`select actor_role from audit_log where action = 'delivery.retry' and target_id = $1`, [s.code])).rows).toEqual([{ actor_role: "manager" }]);
  });

  test("works after the provider cancelled the first rider, without reusing the old booking", async () => {
    const s = await setup("accepted");
    await queueDeliveries(s.d());
    await dispatchQueued(s.d());
    const first = (await row(s.orderId)).provider_ref as string;
    await s.delivery.cancel(first, "rider unavailable");
    await syncDeliveries(s.d());
    expect((await order(s.orderId)).status).toBe("delivery_failed");
    await retryDelivery((await makeUser("owner")).ctx, s.code, s.d());
    const now = await row(s.orderId);
    expect(now.status).toBe("pending");
    expect(now.provider_ref).not.toBe(first);
  });

  test("is refused for an order whose delivery has not failed, and cannot be done twice", async () => {
    const s = await failed();
    const { ctx } = await makeUser("manager");
    await retryDelivery(ctx, s.code, s.d());
    await expect(retryDelivery(ctx, s.code, s.d())).rejects.toBeInstanceOf(DeliveryError);
    const other = await setup("accepted");
    await expect(retryDelivery(ctx, other.code, other.d())).rejects.toBeInstanceOf(DeliveryError);
  });

  test("kitchen and customers cannot retry", async () => {
    const s = await failed();
    for (const role of ["kitchen", "customer"] as const) {
      await expect(retryDelivery((await makeUser(role)).ctx, s.code, s.d())).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect((await order(s.orderId)).status).toBe("delivery_failed");
  });
});

describe("cancelling a delivery order", () => {
  test("a failed order is cancelled and refunded, with no rider to cancel", async () => {
    const s = await failed();
    const { ctx } = await makeUser("manager");
    expect(await cancelAndRefund(ctx, s.code, s.r())).toEqual({ refunded: true });
    expect((await order(s.orderId)).status).toBe("refunded");
    expect((await row(s.orderId)).status).toBe("failed");
    expect(s.payment.refunds).toHaveLength(1);
  });

  test("an order with a rider already booked has the rider cancelled too", async () => {
    const s = await setup("accepted");
    await queueDeliveries(s.d());
    await dispatchQueued(s.d());
    const ref = (await row(s.orderId)).provider_ref as string;
    const { ctx } = await makeUser("manager");
    await cancelAndRefund(ctx, s.code, s.r());
    expect((await row(s.orderId)).status).toBe("cancelled");
    await expect(s.delivery.cancel(ref, "again")).rejects.toThrow(/cancel/i); // already cancelled at the provider
    expect((await order(s.orderId)).status).toBe("refunded");
  });

  test("a delivery that was never booked is simply dropped, and never booked afterwards", async () => {
    const s = await setup("accepted");
    await queueDeliveries(s.d());
    const { ctx } = await makeUser("manager");
    await cancelAndRefund(ctx, s.code, s.r());
    expect((await row(s.orderId)).status).toBe("cancelled");
    await dispatchQueued(s.d());
    expect(s.delivery.created).toEqual([]);
  });

  test("if the rider cannot be cancelled the order is still cancelled and refunded, and a manager is told", async () => {
    const s = await setup("accepted");
    await queueDeliveries(s.d());
    await dispatchQueued(s.d());
    s.delivery.cancel = async () => {
      throw new Error("provider down");
    };
    const { ctx } = await makeUser("manager");
    expect(await cancelAndRefund(ctx, s.code, s.r())).toEqual({ refunded: true });
    expect((await order(s.orderId)).status).toBe("refunded");
    expect(await alertCount(s.orderId, "delivery_failed")).toBe(1);
  });
});
