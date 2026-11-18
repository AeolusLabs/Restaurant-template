import { afterAll, describe, expect, inject, test } from "vitest";
import { closePools } from "../src/db/context";
import { getOrderForCustomer } from "../src/db/orders";
import { getOrderForStaff } from "../src/db/staff-orders";
import { latestWalletSnapshot } from "../src/db/wallet";
import { toPublicOrder } from "../src/lib/sanitize";
import { admin, closeFixtures, makeOrder, makeUser } from "./helpers/fixtures";

const urls = inject("dbUrls");
afterAll(async () => {
  await closePools();
  await closeFixtures();
});

async function deliveryOrder(owner: string, status: "paid" | "ready" | "out_for_delivery" = "out_for_delivery") {
  const { orderId } = await makeOrder(owner, status, "delivery");
  await admin().query(`update orders set delivery_fee_minor = 150000, total_minor = 400000 where id = $1`, [orderId]);
  await admin().query(`insert into order_contacts (order_id, phone, address_snapshot) values ($1, '+2348031112222', '{"zone":"Island","address":"12 Admiralty Way, Lekki","landmark":"Blue gate"}')`, [orderId]);
  const code = (await admin().query(`select public_code from orders where id = $1`, [orderId])).rows[0].public_code as string;
  return { orderId, code };
}
const book = (orderId: string, tracking: string | null = "https://track.example.test/abc") =>
  admin().query(
    `insert into deliveries (order_id, provider, status, provider_ref, quote_id, fee_charged_minor, provider_cost_minor, tracking_url, attempts)
     values ($1, 'mock', 'in_transit', $3, 'secret-quote', 150000, 140000, $2, 1)`,
    [orderId, tracking, `secret-provider-ref-${orderId}`],
  );

describe("what a customer sees of their delivery", () => {
  test("the rider's progress, the tracking link and where it is going", async () => {
    const me = await makeUser("customer");
    const o = await deliveryOrder(me.userId);
    await book(o.orderId);
    const found = await getOrderForCustomer(me.ctx, o.code, { url: urls.app });
    expect(found?.delivery).toEqual({ status: "in_transit", trackingUrl: "https://track.example.test/abc" });
    expect(found?.dropoff).toEqual({ zone: "Island", address: "12 Admiralty Way, Lekki", landmark: "Blue gate" });
  });

  test("an order not yet booked has no delivery yet, and a pickup order never has one", async () => {
    const me = await makeUser("customer");
    const o = await deliveryOrder(me.userId, "paid");
    expect((await getOrderForCustomer(me.ctx, o.code, { url: urls.app }))?.delivery).toBeNull();
    const pickup = await makeOrder(me.userId, "paid", "pickup");
    const code = (await admin().query(`select public_code from orders where id = $1`, [pickup.orderId])).rows[0].public_code as string;
    const found = await getOrderForCustomer(me.ctx, code, { url: urls.app });
    expect(found?.delivery).toBeNull();
    expect(found?.dropoff).toBeNull();
  });

  test("another customer cannot see the order or its delivery", async () => {
    const me = await makeUser("customer");
    const o = await deliveryOrder(me.userId);
    await book(o.orderId);
    const other = await makeUser("customer");
    expect(await getOrderForCustomer(other.ctx, o.code, { url: urls.app })).toBeNull();
  });

  test("the public order carries the status and link only: no provider reference, quote or cost", async () => {
    const me = await makeUser("customer");
    const o = await deliveryOrder(me.userId);
    await book(o.orderId);
    const found = (await getOrderForCustomer(me.ctx, o.code, { url: urls.app }))!;
    const json = JSON.stringify(toPublicOrder(found.order, found.items, { delivery: found.delivery, dropoff: found.dropoff }));
    expect(json).toContain("https://track.example.test/abc");
    for (const secret of ["secret-provider-ref", "secret-quote", "140000", "providerRef", "quoteId", "providerCost", "attempts"]) expect(json).not.toContain(secret);
  });

  test("a tracking link that is not a web address is never passed on", async () => {
    const me = await makeUser("customer");
    const o = await deliveryOrder(me.userId);
    await book(o.orderId, "javascript:alert(1)");
    const found = (await getOrderForCustomer(me.ctx, o.code, { url: urls.app }))!;
    expect(found.delivery?.trackingUrl).toBeNull();
  });

  test("the public order of a pickup order has no delivery", () => {
    const row = { publicCode: "ABC234", status: "paid", fulfilment: "pickup", pickupAt: null, subtotalMinor: 1, discountMinor: 0, serviceChargeMinor: 0, taxMinor: 0, deliveryFeeMinor: 0, totalMinor: 1, currency: "NGN", notes: null, placedAt: new Date(), expiresAt: null };
    expect(toPublicOrder(row, [])).toMatchObject({ delivery: null, dropoff: null });
  });
});

describe("what staff see of a delivery", () => {
  test("managers and owners get the booking, the money and the failure reason; the kitchen gets none of it", async () => {
    const me = await makeUser("customer");
    const o = await deliveryOrder(me.userId);
    await book(o.orderId);
    await admin().query(`update deliveries set failure_reason = 'earlier attempt failed', round = 2 where order_id = $1`, [o.orderId]);
    const manager = await makeUser("manager");
    const seen = await getOrderForStaff(manager.ctx, o.code, { url: urls.app });
    expect(seen?.delivery).toMatchObject({ status: "in_transit", provider: "mock", attempts: 1, round: 2, feeChargedMinor: 150000, providerCostMinor: 140000, failureReason: "earlier attempt failed", trackingUrl: "https://track.example.test/abc" });
    expect(seen?.dropoff).toEqual({ zone: "Island", address: "12 Admiralty Way, Lekki", landmark: "Blue gate" });
    const kitchen = await makeUser("kitchen");
    expect((await getOrderForStaff(kitchen.ctx, o.code, { url: urls.app }))?.delivery ?? null).toBeNull();
  });

  test("a pickup order has no delivery", async () => {
    const me = await makeUser("customer");
    const { orderId } = await makeOrder(me.userId, "paid", "pickup");
    const code = (await admin().query(`select public_code from orders where id = $1`, [orderId])).rows[0].public_code as string;
    const seen = await getOrderForStaff((await makeUser("manager")).ctx, code, { url: urls.app });
    expect(seen?.delivery).toBeNull();
    expect(seen?.dropoff).toBeNull();
  });
});

describe("latestWalletSnapshot", () => {
  test("managers see the most recent balance, the kitchen sees none, and nothing checked yet is null", async () => {
    const manager = await makeUser("manager");
    await admin().query(`insert into wallet_snapshots (balance_minor, checked_at) values (123456, now() + interval '10 years')`);
    expect(await latestWalletSnapshot(manager.ctx, { url: urls.app })).toMatchObject({ balanceMinor: 123456 });
    expect(await latestWalletSnapshot((await makeUser("kitchen")).ctx, { url: urls.app })).toBeNull();
  });
});
