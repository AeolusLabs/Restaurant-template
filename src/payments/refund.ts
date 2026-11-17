import { and, eq, inArray } from "drizzle-orm";
import { ForbiddenError } from "@/auth/session";
import { raiseAlert } from "@/db/alerts";
import { withRequestContext, withSystemContext, type RequestContext, type Tx } from "@/db/context";
import { orders, payments, refunds } from "@/db/schema";
import { staffTransitionOrder } from "@/db/staff-actions";
import { transitionOrder } from "@/db/transition-order";
import { OrderNotFoundError } from "@/domain/orders/transitions";
import { providers } from "@/providers";
import type { PaymentProvider } from "@/providers/payment/types";

export type RefundErrorCode = "not_refundable" | "no_payment" | "already_refunded" | "provider_failed";

/** A refund cannot be made. The message is written for the staff member. */
export class RefundError extends Error {
  constructor(
    readonly code: RefundErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type RefundActor = { type: "staff"; ctx: RequestContext } | { type: "system" };
export type RefundDeps = { provider?: PaymentProvider; systemUrl?: string; appUrl?: string; reason?: string };

const isUniqueViolation = (err: unknown) => (err as { cause?: { code?: string } })?.cause?.code === "23505";

/**
 * Returns the whole payment for a cancelled or completed order and moves the order to refunded.
 * The refund is reserved in the database first (a unique index allows one live refund per payment), then the
 * provider is asked, so two people pressing the button together cannot refund twice. If the provider refuses,
 * the reservation is marked failed and an alert is raised, the order stays as it was, and the refund can be retried.
 */
export async function refundOrder(actor: RefundActor, publicCode: string, deps: RefundDeps = {}): Promise<void> {
  if (actor.type === "staff" && actor.ctx.role !== "owner" && actor.ctx.role !== "manager") {
    throw new ForbiddenError("Only owners and managers can refund an order");
  }
  const provider = deps.provider ?? providers().payment;
  const sys = { url: deps.systemUrl };
  const reason = deps.reason ?? null;

  let reserved: { orderId: string; status: "cancelled" | "completed"; paymentId: string; reference: string; amountMinor: number; refundId: string };
  try {
    reserved = await withSystemContext(async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.publicCode, publicCode)).for("update");
      if (!order) throw new OrderNotFoundError("Order not found");
      if (order.status !== "cancelled" && order.status !== "completed") {
        throw new RefundError("not_refundable", "Only a cancelled or completed order can be refunded");
      }
      const paid = await tx.select().from(payments).where(eq(payments.orderId, order.id));
      const payment = paid.find((p) => p.status === "succeeded");
      if (!payment) {
        throw paid.some((p) => p.status === "refunded" || p.status === "partially_refunded")
          ? new RefundError("already_refunded", "This order has already been refunded")
          : new RefundError("no_payment", "No successful payment was found for this order");
      }
      const [refund] = await tx
        .insert(refunds)
        .values({ paymentId: payment.id, amountMinor: payment.amountMinor, reason, status: "pending", createdBy: actor.type === "staff" ? actor.ctx.userId : null })
        .returning({ id: refunds.id });
      return { orderId: order.id, status: order.status, paymentId: payment.id, reference: payment.reference, amountMinor: payment.amountMinor, refundId: refund.id };
    }, sys);
  } catch (err) {
    if (isUniqueViolation(err)) throw new RefundError("already_refunded", "This order is already being refunded");
    throw err;
  }

  let providerRef: string;
  try {
    ({ providerRef } = await provider.refund({ reference: reserved.reference, amountMinor: reserved.amountMinor, ...(reason ? { reason } : {}) }));
  } catch (err) {
    console.error("refund failed at the provider:", err instanceof Error ? err.message : err);
    await withSystemContext(async (tx) => {
      await tx.update(refunds).set({ status: "failed" }).where(eq(refunds.id, reserved.refundId));
      await raiseAlert(tx, { kind: "refund_failed", severity: "critical", orderId: reserved.orderId, payload: { reference: reserved.reference, amountMinor: reserved.amountMinor } });
    }, sys);
    throw new RefundError("provider_failed", "The payment provider did not accept the refund. The order is unchanged and the refund can be tried again.");
  }

  await withSystemContext(async (tx) => {
    await tx.update(refunds).set({ providerRef }).where(eq(refunds.id, reserved.refundId));
    await tx.update(payments).set({ status: "refunded" }).where(eq(payments.id, reserved.paymentId));
  }, sys);

  if (actor.type === "staff") {
    await staffTransitionOrder(actor.ctx, publicCode, "refunded", { expectedFrom: reserved.status, ...(reason ? { reason } : {}) }, { appUrl: deps.appUrl });
  } else {
    await transitionOrder({ orderId: reserved.orderId, to: "refunded", actor: { type: "system" }, expectedFrom: reserved.status, ...(reason ? { reason } : {}) }, { systemUrl: deps.systemUrl });
  }
}

/**
 * Cancels an order that staff may cancel (paid or accepted) and returns the money in one step. If the refund
 * cannot be made the order stays cancelled and `refunded` is false: an alert is raised and the refund can be
 * retried from the order screen.
 */
export async function cancelAndRefund(ctx: RequestContext, publicCode: string, deps: RefundDeps = {}): Promise<{ refunded: boolean }> {
  const current = await withRequestContext(
    ctx,
    async (tx) => (await tx.select({ status: orders.status }).from(orders).where(eq(orders.publicCode, publicCode)).limit(1))[0],
    { url: deps.appUrl },
  );
  if (!current) throw new OrderNotFoundError("Order not found");
  if (current.status !== "cancelled") {
    await staffTransitionOrder(ctx, publicCode, "cancelled", { expectedFrom: current.status, ...(deps.reason ? { reason: deps.reason } : {}) }, { appUrl: deps.appUrl });
  }
  try {
    await refundOrder({ type: "staff", ctx }, publicCode, deps);
    return { refunded: true };
  } catch (err) {
    if (err instanceof RefundError) return { refunded: false };
    throw err;
  }
}

/** The provider says a refund was processed: mark our record succeeded. Runs inside the webhook's transaction. */
export async function markRefundProcessed(tx: Tx, reference: string): Promise<"refund_recorded" | "unknown_reference" | "ignored"> {
  const found = await tx.select({ id: payments.id }).from(payments).where(eq(payments.reference, reference));
  if (found.length === 0) return "unknown_reference";
  const done = await tx
    .update(refunds)
    .set({ status: "succeeded" })
    .where(and(inArray(refunds.paymentId, found.map((p) => p.id)), eq(refunds.status, "pending")))
    .returning({ id: refunds.id });
  return done.length > 0 ? "refund_recorded" : "ignored";
}
