import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, inject, test } from "vitest";
import { closePools } from "../src/db/context";
import { expireUnpaidOrders } from "../src/jobs/expire-unpaid";
import { PaymentStartError, startPayment } from "../src/payments/start-payment";
import { handlePaymentWebhook } from "../src/payments/webhook";
import { OrderNotFoundError } from "../src/domain/orders/transitions";
import { MockPaymentProvider, signMockWebhook } from "../src/providers/payment/mock";
import type { PaymentVerification } from "../src/providers/payment/types";
import { admin, closeFixtures, makeOrder, makeUser } from "./helpers/fixtures";

const urls = inject("dbUrls");

/** The mock, with counters and hooks for the cases the plain mock cannot express. */
class TestProvider extends MockPaymentProvider {
  verifyCalls = 0;
  override?: (reference: string) => PaymentVerification | Error | undefined;
  async verify(reference: string): Promise<PaymentVerification> {
    this.verifyCalls++;
    const o = this.override?.(reference);
    if (o instanceof Error) throw o;
    return o ?? super.verify(reference);
  }
}

let provider: TestProvider;
beforeEach(() => {
  provider = new TestProvider();
});
afterAll(async () => {
  await closePools();
  await closeFixtures();
});

const deps = () => ({ provider, appUrl: urls.app, systemUrl: urls.system, baseUrl: "https://shop.example.com", now: new Date() });

async function placedOrder(over: { total?: number; expiresInMinutes?: number } = {}) {
  const user = await makeUser("customer");
  const { orderId } = await makeOrder(user.userId);
  await admin().query(`update orders set total_minor = $2, subtotal_minor = $2, expires_at = now() + ($3 || ' minutes')::interval where id = $1`, [
    orderId, over.total ?? 100_000, String(over.expiresInMinutes ?? 30),
  ]);
  const { rows } = await admin().query(`select public_code from orders where id = $1`, [orderId]);
  return { ...user, orderId, code: rows[0].public_code as string };
}

const orderStatus = async (id: string) => (await admin().query(`select status from orders where id = $1`, [id])).rows[0].status as string;
const paymentRows = async (orderId: string) => (await admin().query(`select reference, status, amount_minor::int as amount_minor, paid_at from payments where order_id = $1 order by created_at`, [orderId])).rows;
const eventsOf = async (orderId: string) => (await admin().query(`select from_status, to_status, actor_type, reason from order_events where order_id = $1 order by created_at`, [orderId])).rows;
const audits = async (action: string, reference: string) => (await admin().query(`select meta from audit_log where action = $1 and target_id = $2`, [action, reference])).rows;

let eventSeq = 0;
function webhook(reference: string, over: { event?: string; id?: string; signature?: string | null; body?: string } = {}) {
  const body = over.body ?? JSON.stringify({ id: over.id ?? `evt-${++eventSeq}-${randomUUID()}`, event: over.event ?? "charge.success", data: { reference } });
  const headers = new Headers();
  if (over.signature !== null) headers.set("x-mock-signature", over.signature ?? signMockWebhook(body));
  return { body, headers };
}
const deliver = (reference: string, over: Parameters<typeof webhook>[1] = {}) => {
  const { body, headers } = webhook(reference, over);
  return handlePaymentWebhook(body, headers, deps());
};

describe("startPayment", () => {
  test("records an initiated payment for the order total and returns the provider's payment page", async () => {
    const o = await placedOrder({ total: 123_400 });
    const started = await startPayment(o.ctx, o.code, { ...deps(), email: "ada@example.com" });
    expect(started.authorizationUrl).toContain(started.reference);
    const rows = await paymentRows(o.orderId);
    expect(rows).toEqual([{ reference: started.reference, status: "initiated", amount_minor: 123_400, paid_at: null }]);
    expect((await admin().query(`select provider, currency from payments where order_id = $1`, [o.orderId])).rows[0]).toEqual({ provider: "mock", currency: "NGN" });
  });

  test("sends the provider the amount from the database and a callback to the order page", async () => {
    const o = await placedOrder({ total: 55_000 });
    let seen: Parameters<MockPaymentProvider["initialize"]>[0] | undefined;
    const original = provider.initialize.bind(provider);
    provider.initialize = async (i) => ((seen = i), original(i));
    await startPayment(o.ctx, o.code, { ...deps(), email: "ada@example.com" });
    expect(seen).toMatchObject({ orderId: o.orderId, amountMinor: 55_000, email: "ada@example.com", callbackUrl: `https://shop.example.com/orders/${o.code}` });
  });

  test("a retry makes a new reference, and both attempts stay on record", async () => {
    const o = await placedOrder();
    const a = await startPayment(o.ctx, o.code, { ...deps(), email: "a@example.com" });
    const b = await startPayment(o.ctx, o.code, { ...deps(), email: "a@example.com" });
    expect(a.reference).not.toBe(b.reference);
    expect(await paymentRows(o.orderId)).toHaveLength(2);
  });

  test("refuses an order that is no longer unpaid, one that has expired, and someone else's", async () => {
    const paid = await placedOrder();
    await admin().query(`update orders set status = 'paid' where id = $1`, [paid.orderId]);
    await expect(startPayment(paid.ctx, paid.code, { ...deps(), email: "a@example.com" })).rejects.toBeInstanceOf(PaymentStartError);

    const late = await placedOrder({ expiresInMinutes: -5 });
    await expect(startPayment(late.ctx, late.code, { ...deps(), email: "a@example.com" })).rejects.toMatchObject({ code: "expired" });

    const mine = await placedOrder();
    const stranger = await makeUser("customer");
    await expect(startPayment(stranger.ctx, mine.code, { ...deps(), email: "a@example.com" })).rejects.toBeInstanceOf(OrderNotFoundError);
    expect(await paymentRows(mine.orderId)).toEqual([]);
  });

  test("when the provider fails, the attempt is marked failed and the customer gets a plain error", async () => {
    const o = await placedOrder();
    provider.initialize = async () => {
      throw new Error("socket hang up sk_live_secret");
    };
    const err = await startPayment(o.ctx, o.code, { ...deps(), email: "a@example.com" }).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentStartError);
    expect(err.message).not.toContain("sk_live_secret");
    expect((await paymentRows(o.orderId))[0].status).toBe("failed");
    expect(await orderStatus(o.orderId)).toBe("placed"); // still payable
  });
});

describe("payment webhook", () => {
  async function started(total = 100_000) {
    const o = await placedOrder({ total });
    const { reference } = await startPayment(o.ctx, o.code, { ...deps(), email: "a@example.com" });
    return { ...o, reference };
  }

  test("a valid, verified payment moves the order to paid and records everything", async () => {
    const o = await started();
    provider.simulatePayment(o.reference, "success");
    const res = await deliver(o.reference);
    expect(res).toMatchObject({ status: 200, outcome: "paid" });
    expect(await orderStatus(o.orderId)).toBe("paid");
    const [p] = await paymentRows(o.orderId);
    expect(p.status).toBe("succeeded");
    expect(p.paid_at).not.toBeNull();
    expect(await eventsOf(o.orderId)).toEqual([{ from_status: "placed", to_status: "paid", actor_type: "system", reason: null }]);
    const stored = await admin().query(`select processed_at from webhook_events where provider = 'mock' and payload->'data'->>'reference' = $1`, [o.reference]);
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0].processed_at).not.toBeNull();
  });

  test("a replayed event changes nothing and does not ask the provider again", async () => {
    const o = await started();
    provider.simulatePayment(o.reference, "success");
    const first = webhook(o.reference, { id: "evt-fixed-1" });
    expect((await handlePaymentWebhook(first.body, first.headers, deps())).outcome).toBe("paid");
    const calls = provider.verifyCalls;
    const again = await handlePaymentWebhook(first.body, first.headers, deps());
    expect(again).toMatchObject({ status: 200, outcome: "duplicate" });
    expect(provider.verifyCalls).toBe(calls);
    expect(await eventsOf(o.orderId)).toHaveLength(1);
  });

  test("two copies of one event arriving together are processed once", async () => {
    const o = await started();
    provider.simulatePayment(o.reference, "success");
    const copy = webhook(o.reference, { id: "evt-fixed-2" });
    const results = await Promise.all([
      handlePaymentWebhook(copy.body, copy.headers, deps()),
      handlePaymentWebhook(copy.body, copy.headers, deps()),
    ]);
    expect(results.map((r) => r.outcome).sort()).toEqual(["duplicate", "paid"]);
    expect(await eventsOf(o.orderId)).toHaveLength(1);
    expect(await paymentRows(o.orderId)).toHaveLength(1);
  });

  test("a bad or missing signature is refused with 401 and stores nothing", async () => {
    const o = await started();
    provider.simulatePayment(o.reference, "success");
    const before = (await admin().query(`select count(*)::int as n from webhook_events`)).rows[0].n;
    expect((await deliver(o.reference, { signature: "00".repeat(64) })).status).toBe(401);
    expect((await deliver(o.reference, { signature: null })).status).toBe(401);
    expect((await admin().query(`select count(*)::int as n from webhook_events`)).rows[0].n).toBe(before);
    expect(await orderStatus(o.orderId)).toBe("placed");
  });

  test("a signature failure is recognised even when it comes from another copy of the error class", async () => {
    // After a development reload, or across bundles, instanceof can fail for the same error.
    provider.parseWebhook = () => {
      throw Object.assign(new Error("invalid webhook signature"), { name: "WebhookSignatureError" });
    };
    const res = await handlePaymentWebhook("{}", new Headers(), deps());
    expect(res.status).toBe(401);
  });

  test("a signed body that is not valid JSON is refused with 400 and stores nothing", async () => {
    const before = (await admin().query(`select count(*)::int as n from webhook_events`)).rows[0].n;
    expect((await deliver("x", { body: "{not json" })).status).toBe(400);
    expect((await admin().query(`select count(*)::int as n from webhook_events`)).rows[0].n).toBe(before);
  });

  test("a verified payment for the wrong amount does not pay the order, and is flagged for review", async () => {
    const o = await started(100_000);
    provider.override = () => ({ status: "success", amountMinor: 1_000, currency: "NGN" });
    expect(await deliver(o.reference)).toMatchObject({ status: 200, outcome: "mismatch" });
    expect(await orderStatus(o.orderId)).toBe("placed");
    expect((await paymentRows(o.orderId))[0].status).toBe("failed");
    expect(await audits("payment.mismatch", o.reference)).toHaveLength(1);
  });

  test("a verified payment in the wrong currency does not pay the order", async () => {
    const o = await started();
    provider.override = () => ({ status: "success", amountMinor: 100_000, currency: "USD" });
    expect((await deliver(o.reference)).outcome).toBe("mismatch");
    expect(await orderStatus(o.orderId)).toBe("placed");
  });

  test("a webhook is not proof: if the provider says the payment did not succeed, the order stays unpaid", async () => {
    const o = await started();
    // The mock reports "abandoned" until simulatePayment is called.
    expect(await deliver(o.reference)).toMatchObject({ status: 200, outcome: "not_successful" });
    expect(await orderStatus(o.orderId)).toBe("placed");
    expect((await paymentRows(o.orderId))[0].status).toBe("initiated");

    provider.simulatePayment(o.reference, "failed");
    await deliver(o.reference);
    expect((await paymentRows(o.orderId))[0].status).toBe("failed");
    expect(await orderStatus(o.orderId)).toBe("placed");
  });

  test("an unknown reference returns 200 and changes nothing, so the provider stops retrying", async () => {
    expect(await deliver("ord-NOSUCH-0000")).toMatchObject({ status: 200, outcome: "unknown_reference" });
  });

  test("an event type we do not act on is stored and acknowledged", async () => {
    const o = await started();
    expect(await deliver(o.reference, { event: "transfer.success" })).toMatchObject({ status: 200, outcome: "ignored" });
    expect(await orderStatus(o.orderId)).toBe("placed");
  });

  test("money that arrives after the order was cancelled is recorded and flagged, not applied", async () => {
    const o = await started();
    await admin().query(`update orders set status = 'cancelled' where id = $1`, [o.orderId]);
    provider.simulatePayment(o.reference, "success");
    expect(await deliver(o.reference)).toMatchObject({ status: 200, outcome: "late" });
    expect(await orderStatus(o.orderId)).toBe("cancelled");
    expect((await paymentRows(o.orderId))[0].status).toBe("succeeded");
    expect(await audits("payment.late", o.reference)).toHaveLength(1);
  });

  test("a second successful payment for an already paid order is recorded and flagged for a refund", async () => {
    const o = await started();
    const second = await startPayment(o.ctx, o.code, { ...deps(), email: "a@example.com" });
    provider.simulatePayment(o.reference, "success");
    provider.simulatePayment(second.reference, "success");
    expect((await deliver(o.reference)).outcome).toBe("paid");
    expect((await deliver(second.reference)).outcome).toBe("duplicate_payment");
    expect(await orderStatus(o.orderId)).toBe("paid");
    expect(await audits("payment.duplicate", second.reference)).toHaveLength(1);
    expect(await eventsOf(o.orderId)).toHaveLength(1);
  });

  test("a failure while processing rolls the event back, so the provider's retry is processed", async () => {
    const o = await started();
    provider.override = () => new Error("provider timeout");
    const copy = webhook(o.reference, { id: "evt-retry-1" });
    await expect(handlePaymentWebhook(copy.body, copy.headers, deps())).rejects.toThrow("provider timeout");
    expect((await admin().query(`select 1 from webhook_events where event_id = 'evt-retry-1'`)).rowCount).toBe(0);

    provider.override = undefined;
    provider.simulatePayment(o.reference, "success");
    expect((await handlePaymentWebhook(copy.body, copy.headers, deps())).outcome).toBe("paid");
  });
});

describe("expireUnpaidOrders", () => {
  test("cancels an overdue unpaid order and fails its open payment attempts", async () => {
    const o = await placedOrder();
    await startPayment(o.ctx, o.code, { ...deps(), email: "a@example.com" });
    await admin().query(`update orders set expires_at = now() - interval '1 minute' where id = $1`, [o.orderId]);
    const result = await expireUnpaidOrders(deps());
    expect(result.expired).toBeGreaterThanOrEqual(1);
    expect(await orderStatus(o.orderId)).toBe("cancelled");
    expect((await paymentRows(o.orderId))[0].status).toBe("failed");
    expect(await eventsOf(o.orderId)).toEqual([{ from_status: "placed", to_status: "cancelled", actor_type: "system", reason: "unpaid expiry" }]);
  });

  test("leaves orders that are not overdue, and orders that are already paid", async () => {
    const fresh = await placedOrder({ expiresInMinutes: 20 });
    const paid = await placedOrder({ expiresInMinutes: -10 });
    await admin().query(`update orders set status = 'paid' where id = $1`, [paid.orderId]);
    await expireUnpaidOrders(deps());
    expect(await orderStatus(fresh.orderId)).toBe("placed");
    expect(await orderStatus(paid.orderId)).toBe("paid");
  });

  test("an overdue order the provider says was paid is marked paid, not cancelled", async () => {
    const o = await placedOrder({ expiresInMinutes: 30 });
    const { reference } = await startPayment(o.ctx, o.code, { ...deps(), email: "a@example.com" });
    provider.simulatePayment(reference, "success"); // the webhook never arrived
    await admin().query(`update orders set expires_at = now() - interval '1 minute' where id = $1`, [o.orderId]);
    const result = await expireUnpaidOrders(deps());
    expect(result.paid).toBeGreaterThanOrEqual(1);
    expect(await orderStatus(o.orderId)).toBe("paid");
    expect((await paymentRows(o.orderId))[0].status).toBe("succeeded");
  });

  test("when the provider cannot be reached the order is left alone this round and the others still expire", async () => {
    const stuck = await placedOrder({ expiresInMinutes: 30 });
    const { reference } = await startPayment(stuck.ctx, stuck.code, { ...deps(), email: "a@example.com" });
    const plain = await placedOrder({ expiresInMinutes: -1 });
    await admin().query(`update orders set expires_at = now() - interval '1 minute' where id = $1`, [stuck.orderId]);
    provider.override = (ref) => (ref === reference ? new Error("provider down") : undefined);
    const result = await expireUnpaidOrders(deps());
    expect(await orderStatus(stuck.orderId)).toBe("placed");
    expect(await orderStatus(plain.orderId)).toBe("cancelled");
    expect(result.skipped).toBeGreaterThanOrEqual(1);
  });
});
