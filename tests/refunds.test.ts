import { afterAll, describe, expect, inject, test } from "vitest";
import { ForbiddenError } from "../src/auth/session";
import { closePools, type RequestContext } from "../src/db/context";
import { staffTransitionOrder } from "../src/db/staff-actions";
import { IllegalTransitionError } from "../src/domain/orders/transitions";
import { cancelMyOrder } from "../src/payments/customer-cancel";
import { RefundError, cancelAndRefund, refundOrder } from "../src/payments/refund";
import { startPayment } from "../src/payments/start-payment";
import { handlePaymentWebhook } from "../src/payments/webhook";
import { MockPaymentProvider, signMockWebhook } from "../src/providers/payment/mock";
import { admin, closeFixtures, makeUser } from "./helpers/fixtures";

const urls = inject("dbUrls");
const deps = (provider: MockPaymentProvider) => ({ provider, systemUrl: urls.system, appUrl: urls.app });
afterAll(async () => {
  await closePools();
  await closeFixtures();
});

async function webhook(provider: MockPaymentProvider, event: string, reference: string, id = `evt-${Math.random()}`) {
  const body = JSON.stringify({ id, event, data: { reference } });
  return handlePaymentWebhook(body, new Headers({ "x-mock-signature": signMockWebhook(body) }), { provider, systemUrl: urls.system });
}

/** A real order, paid through the real webhook path. */
async function paidOrder(provider: MockPaymentProvider, total = 250_000) {
  const customer = await makeUser("customer");
  const { rows } = await admin().query(
    `insert into orders (public_code, profile_id, customer_name, status, fulfilment, subtotal_minor, total_minor, currency, expires_at)
     values (upper(substr(md5(random()::text), 1, 8)), $1, 'Test customer', 'placed', 'pickup', $2, $2, 'NGN', now() + interval '30 minutes') returning id, public_code`,
    [customer.userId, total],
  );
  const orderId = rows[0].id as string;
  const code = rows[0].public_code as string;
  const { reference } = await startPayment(customer.ctx, code, { provider, email: "a@example.com", baseUrl: "http://x", appUrl: urls.app, systemUrl: urls.system });
  provider.simulatePayment(reference, "success");
  await webhook(provider, "charge.success", reference);
  return { orderId, code, reference, customer };
}
const statusOf = async (id: string) => (await admin().query(`select status from orders where id = $1`, [id])).rows[0].status as string;
const refundRows = async (orderId: string) =>
  (await admin().query(`select r.status, r.amount_minor::int as amt, r.provider_ref, r.reason from refunds r join payments p on p.id = r.payment_id where p.order_id = $1 order by r.created_at`, [orderId])).rows;
const payStatus = async (orderId: string) => (await admin().query(`select status from payments where order_id = $1`, [orderId])).rows[0].status as string;
const alertKinds = async (orderId: string) => (await admin().query(`select kind from alerts where order_id = $1 order by created_at`, [orderId])).rows.map((r) => r.kind);

async function cancelled(provider: MockPaymentProvider, manager: RequestContext) {
  const o = await paidOrder(provider);
  await staffTransitionOrder(manager, o.code, "cancelled", { expectedFrom: "paid" }, { appUrl: urls.app });
  return o;
}

describe("refundOrder", () => {
  test("returns the whole payment, marks it refunded, and moves the order to refunded", async () => {
    const provider = new MockPaymentProvider();
    const { ctx } = await makeUser("manager");
    const o = await cancelled(provider, ctx);
    await refundOrder({ type: "staff", ctx }, o.code, { ...deps(provider), reason: "out of rice" });
    expect(provider.refunds).toEqual([{ reference: o.reference, amountMinor: 250_000, reason: "out of rice" }]);
    expect(await refundRows(o.orderId)).toEqual([{ status: "pending", amt: 250_000, provider_ref: "mock-refund-1", reason: "out of rice" }]);
    expect(await payStatus(o.orderId)).toBe("refunded");
    expect(await statusOf(o.orderId)).toBe("refunded");
    expect((await admin().query(`select action from audit_log where target_id = $1 order by created_at`, [o.code])).rows.map((r) => r.action)).toEqual(["order.cancelled", "order.refunded"]);
  });

  test("works for a completed order too", async () => {
    const provider = new MockPaymentProvider();
    const { ctx } = await makeUser("owner");
    const o = await paidOrder(provider);
    for (const step of ["accepted", "preparing", "ready", "picked_up", "completed"]) {
      await admin().query(`update orders set status = $2 where id = $1`, [o.orderId, step]);
    }
    await refundOrder({ type: "staff", ctx }, o.code, deps(provider));
    expect(await statusOf(o.orderId)).toBe("refunded");
  });

  test("is refused for an order that is still live, and the provider is not called", async () => {
    const provider = new MockPaymentProvider();
    const { ctx } = await makeUser("manager");
    const o = await paidOrder(provider);
    await expect(refundOrder({ type: "staff", ctx }, o.code, deps(provider))).rejects.toMatchObject({ code: "not_refundable" });
    expect(provider.refunds).toEqual([]);
    expect(await statusOf(o.orderId)).toBe("paid");
  });

  test("is refused when nothing was paid", async () => {
    const provider = new MockPaymentProvider();
    const { ctx } = await makeUser("manager");
    const o = await paidOrder(provider);
    await admin().query(`update payments set status = 'failed' where order_id = $1`, [o.orderId]);
    await admin().query(`update orders set status = 'cancelled' where id = $1`, [o.orderId]);
    await expect(refundOrder({ type: "staff", ctx }, o.code, deps(provider))).rejects.toMatchObject({ code: "no_payment" });
  });

  test("kitchen and customers cannot refund", async () => {
    const provider = new MockPaymentProvider();
    const { ctx: manager } = await makeUser("manager");
    const o = await cancelled(provider, manager);
    for (const role of ["kitchen", "customer"] as const) {
      const { ctx } = await makeUser(role);
      await expect(refundOrder({ type: "staff", ctx }, o.code, deps(provider))).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect(provider.refunds).toEqual([]);
  });

  test("refunds once, even when two people press the button together", async () => {
    const provider = new MockPaymentProvider();
    const [a, b] = [await makeUser("manager"), await makeUser("owner")];
    const o = await cancelled(provider, a.ctx);
    const results = await Promise.allSettled([
      refundOrder({ type: "staff", ctx: a.ctx }, o.code, deps(provider)),
      refundOrder({ type: "staff", ctx: b.ctx }, o.code, deps(provider)),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason as RefundError).code).toMatch(/already_refunded|not_refundable/);
    expect(provider.refunds).toHaveLength(1);
    expect(await refundRows(o.orderId)).toHaveLength(1);
  });

  test("a provider refusal leaves the order cancelled, raises an alert, and a retry works", async () => {
    const provider = new MockPaymentProvider();
    const { ctx } = await makeUser("manager");
    const o = await cancelled(provider, ctx);
    const original = provider.refund.bind(provider);
    provider.refund = async () => {
      throw new Error("provider down");
    };
    await expect(refundOrder({ type: "staff", ctx }, o.code, deps(provider))).rejects.toMatchObject({ code: "provider_failed" });
    expect(await statusOf(o.orderId)).toBe("cancelled");
    expect((await refundRows(o.orderId)).map((r) => r.status)).toEqual(["failed"]);
    expect(await alertKinds(o.orderId)).toEqual(["refund_failed"]);

    provider.refund = original;
    await refundOrder({ type: "staff", ctx }, o.code, deps(provider));
    expect(await statusOf(o.orderId)).toBe("refunded");
    expect((await refundRows(o.orderId)).map((r) => r.status)).toEqual(["failed", "pending"]);
  });
});

describe("a refund that was paid out but never reached the order", () => {
  test("pressing Refund again finishes the order without asking the provider a second time", async () => {
    const provider = new MockPaymentProvider();
    const { ctx } = await makeUser("manager");
    const o = await cancelled(provider, ctx);
    // The state left behind when the provider returned the money but the order could not be moved to refunded.
    await admin().query(`insert into refunds (payment_id, amount_minor, status, provider_ref) select id, amount_minor, 'pending', 'mock-refund-x' from payments where order_id = $1`, [o.orderId]);
    await admin().query(`update payments set status = 'refunded' where order_id = $1`, [o.orderId]);
    expect(await statusOf(o.orderId)).toBe("cancelled");

    await refundOrder({ type: "staff", ctx }, o.code, deps(provider));
    expect(await statusOf(o.orderId)).toBe("refunded");
    expect(provider.refunds).toEqual([]); // the money had already gone back; nothing more is asked of the provider
    expect(await refundRows(o.orderId)).toHaveLength(1);
  });

  test("a refund with no provider reference yet is not treated as paid out", async () => {
    const provider = new MockPaymentProvider();
    const { ctx } = await makeUser("manager");
    const o = await cancelled(provider, ctx);
    await admin().query(`insert into refunds (payment_id, amount_minor, status) select id, amount_minor, 'pending' from payments where order_id = $1`, [o.orderId]);
    await expect(refundOrder({ type: "staff", ctx }, o.code, deps(provider))).rejects.toMatchObject({ code: "already_refunded" });
    expect(await statusOf(o.orderId)).toBe("cancelled");
  });
});

describe("the refund webhook", () => {
  test("marks the refund succeeded, once", async () => {
    const provider = new MockPaymentProvider();
    const { ctx } = await makeUser("manager");
    const o = await cancelled(provider, ctx);
    await refundOrder({ type: "staff", ctx }, o.code, deps(provider));
    expect((await webhook(provider, "refund.processed", o.reference, "evt-refund-1")).outcome).toBe("refund_recorded");
    expect((await refundRows(o.orderId))[0].status).toBe("succeeded");
    expect((await webhook(provider, "refund.processed", o.reference, "evt-refund-1")).outcome).toBe("duplicate");
  });

  test("a refund event for an unknown payment is acknowledged and changes nothing", async () => {
    const provider = new MockPaymentProvider();
    expect(await webhook(provider, "refund.processed", "ord-NOSUCH-1")).toMatchObject({ status: 200, outcome: "unknown_reference" });
  });
});

describe("cancelAndRefund", () => {
  test("a manager cancels a paid order and returns the money in one step", async () => {
    const provider = new MockPaymentProvider();
    const { ctx } = await makeUser("manager");
    const o = await paidOrder(provider);
    const r = await cancelAndRefund(ctx, o.code, { ...deps(provider), reason: "closing early" });
    expect(r).toEqual({ refunded: true });
    expect(await statusOf(o.orderId)).toBe("refunded");
    expect(provider.refunds).toHaveLength(1);
  });

  test("if the refund fails the order is still cancelled, and the answer says the refund is owed", async () => {
    const provider = new MockPaymentProvider();
    const { ctx } = await makeUser("manager");
    const o = await paidOrder(provider);
    provider.refund = async () => {
      throw new Error("down");
    };
    expect(await cancelAndRefund(ctx, o.code, deps(provider))).toEqual({ refunded: false });
    expect(await statusOf(o.orderId)).toBe("cancelled");
  });

  test("an unpaid order cannot be cancelled by staff: it expires by itself", async () => {
    const provider = new MockPaymentProvider();
    const { ctx } = await makeUser("manager");
    const customer = await makeUser("customer");
    const { rows } = await admin().query(
      `insert into orders (public_code, profile_id, customer_name, status, fulfilment, subtotal_minor, total_minor, currency) values (upper(substr(md5(random()::text), 1, 8)), $1, 'T', 'placed', 'pickup', 1, 1, 'NGN') returning id, public_code`,
      [customer.userId],
    );
    await expect(cancelAndRefund(ctx, rows[0].public_code, deps(provider))).rejects.toBeInstanceOf(IllegalTransitionError);
    expect(await statusOf(rows[0].id)).toBe("placed");
    expect(provider.refunds).toEqual([]);
  });
});

describe("a customer cancelling their own order", () => {
  test("before the restaurant accepts it, the order is cancelled and refunded", async () => {
    const provider = new MockPaymentProvider();
    const o = await paidOrder(provider);
    expect(await cancelMyOrder(o.customer.ctx, o.code, deps(provider))).toEqual({ refunded: true });
    expect(await statusOf(o.orderId)).toBe("refunded");
    expect(provider.refunds).toEqual([{ reference: o.reference, amountMinor: 250_000, reason: "customer cancelled" }]);
  });

  test("after it is accepted, they cannot, and nothing is refunded", async () => {
    const provider = new MockPaymentProvider();
    const o = await paidOrder(provider);
    await admin().query(`update orders set status = 'accepted' where id = $1`, [o.orderId]);
    await expect(cancelMyOrder(o.customer.ctx, o.code, deps(provider))).rejects.toBeInstanceOf(IllegalTransitionError);
    expect(provider.refunds).toEqual([]);
    expect(await statusOf(o.orderId)).toBe("accepted");
  });

  test("an unpaid order is simply cancelled", async () => {
    const provider = new MockPaymentProvider();
    const customer = await makeUser("customer");
    const { rows } = await admin().query(
      `insert into orders (public_code, profile_id, customer_name, status, fulfilment, subtotal_minor, total_minor, currency) values (upper(substr(md5(random()::text), 1, 8)), $1, 'T', 'placed', 'pickup', 1, 1, 'NGN') returning id, public_code`,
      [customer.userId],
    );
    expect(await cancelMyOrder(customer.ctx, rows[0].public_code, deps(provider))).toEqual({ refunded: false });
    expect(await statusOf(rows[0].id)).toBe("cancelled");
  });

  test("when the refund fails, the order is still cancelled and the manager is alerted", async () => {
    const provider = new MockPaymentProvider();
    const o = await paidOrder(provider);
    provider.refund = async () => {
      throw new Error("down");
    };
    expect(await cancelMyOrder(o.customer.ctx, o.code, deps(provider))).toEqual({ refunded: false });
    expect(await statusOf(o.orderId)).toBe("cancelled");
    expect(await alertKinds(o.orderId)).toEqual(["refund_failed"]);
  });
});
