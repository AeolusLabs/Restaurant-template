import { afterAll, describe, expect, inject, test } from "vitest";
import { restaurantConfig } from "../config/restaurant";
import type { RestaurantConfig } from "../config/schema";
import { closePools } from "../src/db/context";
import { dispatchQueued, queueDeliveries } from "../src/delivery/dispatch";
import { syncDeliveries } from "../src/delivery/sync";
import { handleDeliveryWebhook } from "../src/delivery/webhook";
import { MockDeliveryProvider, signMockDeliveryWebhook } from "../src/providers/delivery/mock";
import type { OrderStatus } from "../src/domain/orders/statuses";
import { admin, closeFixtures, makeOrder, makeUser } from "./helpers/fixtures";

const urls = inject("dbUrls");
const config: RestaurantConfig = { ...restaurantConfig, features: { ...restaurantConfig.features, delivery: true } };
// A few seconds ahead, so a delivery queued a moment ago is always due (the database stamps the due time).
const run = (provider: MockDeliveryProvider, only: string[]) => ({ provider, systemUrl: urls.system, config, onlyOrderIds: only, now: new Date(Date.now() + 5_000) });
afterAll(async () => {
  await closePools();
  await closeFixtures();
});

/** A delivery order with a rider already booked through the real dispatch code. */
async function booked(status: OrderStatus = "accepted") {
  const provider = new MockDeliveryProvider();
  const user = await makeUser("customer");
  const { orderId } = await makeOrder(user.userId, status, "delivery");
  await admin().query(`update orders set delivery_fee_minor = 150000 where id = $1`, [orderId]);
  await admin().query(`insert into order_contacts (order_id, phone, address_snapshot) values ($1, '+2348031112222', '{"zone":"Island","address":"1 Test Road"}')`, [orderId]);
  await queueDeliveries(run(provider, [orderId]));
  await dispatchQueued(run(provider, [orderId]));
  const d = (await admin().query(`select provider_ref from deliveries where order_id = $1`, [orderId])).rows[0];
  return { provider, orderId, ref: d.provider_ref as string };
}
const sync = (b: { provider: MockDeliveryProvider; orderId: string }) => syncDeliveries(run(b.provider, [b.orderId]));
const rowStatus = async (orderId: string) => (await admin().query(`select status from deliveries where order_id = $1`, [orderId])).rows[0].status as string;
const order = async (id: string) => (await admin().query(`select status, resume_state from orders where id = $1`, [id])).rows[0];
const events = async (id: string) => (await admin().query(`select from_status, to_status, actor_type from order_events where order_id = $1 order by created_at, id`, [id])).rows.map((r) => `${r.from_status}>${r.to_status}:${r.actor_type}`);
const setOrder = (id: string, status: string) => admin().query(`update orders set status = $2 where id = $1`, [id, status]);

describe("syncDeliveries", () => {
  test("follows the rider: assigned, then picked up", async () => {
    const b = await booked("ready");
    b.provider.advance(b.ref);
    await sync(b);
    expect(await rowStatus(b.orderId)).toBe("awaiting_pickup");
    expect((await order(b.orderId)).status).toBe("ready");
    b.provider.advance(b.ref);
    await sync(b);
    expect(await rowStatus(b.orderId)).toBe("in_transit");
    expect((await order(b.orderId)).status).toBe("out_for_delivery");
  });

  test("a rider who picks up before the kitchen says ready does not move the order until it is ready", async () => {
    const b = await booked("preparing");
    b.provider.advance(b.ref);
    b.provider.advance(b.ref);
    await sync(b);
    expect(await rowStatus(b.orderId)).toBe("in_transit");
    expect((await order(b.orderId)).status).toBe("preparing");
    await setOrder(b.orderId, "ready");
    await sync(b);
    expect((await order(b.orderId)).status).toBe("out_for_delivery");
  });

  test("delivered completes the order, and the system is recorded as the one who did it", async () => {
    const b = await booked("ready");
    for (let i = 0; i < 3; i++) b.provider.advance(b.ref);
    await sync(b);
    expect(await rowStatus(b.orderId)).toBe("delivered");
    expect((await order(b.orderId)).status).toBe("completed");
    expect(await events(b.orderId)).toEqual(["ready>out_for_delivery:system", "out_for_delivery>completed:system"]);
  });

  test("delivered when the order is not yet ready waits, then completes once it is", async () => {
    const b = await booked("preparing");
    for (let i = 0; i < 3; i++) b.provider.advance(b.ref);
    await sync(b);
    expect((await order(b.orderId)).status).toBe("preparing");
    await setOrder(b.orderId, "ready");
    await sync(b);
    expect((await order(b.orderId)).status).toBe("completed");
  });

  test("running it again changes nothing and records nothing more", async () => {
    const b = await booked("ready");
    for (let i = 0; i < 3; i++) b.provider.advance(b.ref);
    await sync(b);
    const before = await events(b.orderId);
    await sync(b);
    await sync(b);
    expect(await events(b.orderId)).toEqual(before);
  });

  test("a cancelled delivery fails the order, once, with an alert, so a manager can act", async () => {
    const b = await booked("accepted");
    await b.provider.cancel(b.ref, "rider unavailable");
    await sync(b);
    await sync(b);
    expect(await rowStatus(b.orderId)).toBe("cancelled");
    expect(await order(b.orderId)).toEqual({ status: "delivery_failed", resume_state: "accepted" });
    const n = (await admin().query(`select count(*)::int as n from alerts where order_id = $1 and kind = 'delivery_failed'`, [b.orderId])).rows[0].n;
    expect(n).toBe(1);
  });

  test("a report that goes backwards (an old message arriving late) is ignored", async () => {
    const b = await booked("ready");
    b.provider.advance(b.ref);
    b.provider.advance(b.ref);
    await sync(b);
    await admin().query(`update deliveries set status = 'in_transit' where order_id = $1`, [b.orderId]);
    const body = JSON.stringify({ id: "evt-old", reference: b.ref, status: "pending" });
    await handleDeliveryWebhook(body, new Headers({ "x-mock-signature": signMockDeliveryWebhook(body) }), { provider: b.provider, systemUrl: urls.system });
    expect(await rowStatus(b.orderId)).toBe("in_transit");
  });

  test("a status we do not know never counts as delivered", async () => {
    const b = await booked("ready");
    const body = JSON.stringify({ id: "evt-weird", reference: b.ref, status: "teleported" });
    const res = await handleDeliveryWebhook(body, new Headers({ "x-mock-signature": signMockDeliveryWebhook(body) }), { provider: b.provider, systemUrl: urls.system });
    expect(res.status).toBe(200);
    expect(await rowStatus(b.orderId)).toBe("pending");
    expect((await order(b.orderId)).status).toBe("ready");
  });

  test("when the provider cannot be reached that delivery is left for the next run", async () => {
    const b = await booked("ready");
    b.provider.getDelivery = async () => {
      throw new Error("provider down");
    };
    const r = await sync(b);
    expect(r.errors).toBeGreaterThanOrEqual(1);
    expect(await rowStatus(b.orderId)).toBe("pending");
  });
});

describe("the delivery webhook", () => {
  const deliver = (b: { provider: MockDeliveryProvider }, body: string, sig = signMockDeliveryWebhook(body)) =>
    handleDeliveryWebhook(body, new Headers(sig ? { "x-mock-signature": sig } : {}), { provider: b.provider, systemUrl: urls.system });

  test("a signed event moves the delivery and the order the same way polling does", async () => {
    const b = await booked("ready");
    const res = await deliver(b, JSON.stringify({ id: `evt-${b.orderId}-1`, reference: b.ref, status: "in_transit" }));
    expect(res).toMatchObject({ status: 200, outcome: "applied" });
    expect(await rowStatus(b.orderId)).toBe("in_transit");
    expect((await order(b.orderId)).status).toBe("out_for_delivery");
  });

  test("a replayed event does nothing", async () => {
    const b = await booked("ready");
    const body = JSON.stringify({ id: `evt-${b.orderId}-replay`, reference: b.ref, status: "in_transit" });
    expect((await deliver(b, body)).outcome).toBe("applied");
    expect((await deliver(b, body)).outcome).toBe("duplicate");
    expect(await events(b.orderId)).toHaveLength(1);
  });

  test("a bad or missing signature is refused with 401 and stores nothing", async () => {
    const b = await booked("ready");
    const body = JSON.stringify({ id: `evt-${b.orderId}-bad`, reference: b.ref, status: "delivered" });
    expect((await deliver(b, body, "00".repeat(32))).status).toBe(401);
    expect((await deliver(b, body, "")).status).toBe(401);
    expect(await rowStatus(b.orderId)).toBe("pending");
    expect((await admin().query(`select 1 from webhook_events where event_id = $1`, [`evt-${b.orderId}-bad`])).rowCount).toBe(0);
  });

  test("an unreadable body is 400, and an unknown delivery is acknowledged and ignored", async () => {
    const b = await booked("ready");
    expect((await deliver(b, "{not json")).status).toBe(400);
    expect(await deliver(b, JSON.stringify({ id: "evt-nobody", reference: "no-such-delivery", status: "delivered" }))).toMatchObject({ status: 200, outcome: "unknown_reference" });
  });
});
