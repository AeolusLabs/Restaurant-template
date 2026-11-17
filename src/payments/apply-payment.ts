import { eq } from "drizzle-orm";
import type { Tx } from "@/db/context";
import { auditLog, orders, payments } from "@/db/schema";
import { raiseAlert } from "@/db/alerts";
import { transitionOrderIn } from "@/db/transition-order";
import type { PaymentProvider } from "@/providers/payment/types";

export type SettleOutcome =
  | "paid" // the order moved from placed to paid
  | "already_applied" // this payment was already recorded as succeeded
  | "mismatch" // the provider confirms a payment, but not for this order's amount or currency
  | "late" // verified, but the order had already been cancelled
  | "duplicate_payment" // verified, but the order was already paid by another payment
  | "failed" // the provider says the payment failed
  | "not_successful" // the provider does not (yet) confirm a payment
  | "unknown_reference";

const audit = (tx: Tx, action: string, reference: string, meta: Record<string, unknown>) =>
  tx.insert(auditLog).values({ actorRole: "system", action, targetType: "payment", targetId: reference, meta });

/**
 * The one place a payment is applied to an order. It asks the provider whether the payment really
 * succeeded (a webhook, or a redirect, is never proof on its own), checks the amount and currency
 * against the order, and only then moves placed to paid. Runs inside the caller's system transaction.
 * Money that cannot be applied (wrong amount, a cancelled order, a second payment) is recorded and flagged
 * in the audit log for staff to refund, never dropped.
 */
export async function settlePayment(tx: Tx, reference: string, provider: PaymentProvider): Promise<SettleOutcome> {
  const [found] = await tx.select({ orderId: payments.orderId }).from(payments).where(eq(payments.reference, reference));
  if (!found) return "unknown_reference";

  // Lock the order before the payment, in every code path, so two workers cannot deadlock on the pair.
  const [order] = await tx.select().from(orders).where(eq(orders.id, found.orderId)).for("update");
  const [payment] = await tx.select().from(payments).where(eq(payments.reference, reference)).for("update");
  if (payment.status === "succeeded" || payment.status === "refunded" || payment.status === "partially_refunded") {
    return "already_applied";
  }

  const verification = await provider.verify(reference);
  if (verification.status === "failed") {
    await tx.update(payments).set({ status: "failed" }).where(eq(payments.id, payment.id));
    return "failed";
  }
  if (verification.status !== "success") return "not_successful";

  if (
    verification.amountMinor !== payment.amountMinor ||
    payment.amountMinor !== order.totalMinor ||
    verification.currency !== order.currency
  ) {
    await tx.update(payments).set({ status: "failed" }).where(eq(payments.id, payment.id));
    await audit(tx, "payment.mismatch", reference, {
      orderId: order.id,
      expectedMinor: order.totalMinor,
      expectedCurrency: order.currency,
      providerMinor: verification.amountMinor,
      providerCurrency: verification.currency,
    });
    await raiseAlert(tx, {
      kind: "payment_mismatch",
      severity: "critical",
      orderId: order.id,
      payload: { reference, expectedMinor: order.totalMinor, providerMinor: verification.amountMinor, providerCurrency: verification.currency },
    });
    return "mismatch";
  }

  await tx.update(payments).set({ status: "succeeded", paidAt: new Date() }).where(eq(payments.id, payment.id));
  if (order.status === "placed") {
    await transitionOrderIn(tx, { orderId: order.id, to: "paid", actor: { type: "system" }, expectedFrom: "placed", meta: { reference } });
    return "paid";
  }
  const late = order.status === "cancelled";
  await audit(tx, late ? "payment.late" : "payment.duplicate", reference, {
    orderId: order.id,
    orderStatus: order.status,
    amountMinor: payment.amountMinor,
  });
  await raiseAlert(tx, {
    kind: late ? "payment_late" : "payment_duplicate",
    severity: late ? "critical" : "warning",
    orderId: order.id,
    payload: { reference, amountMinor: payment.amountMinor, orderStatus: order.status },
  });
  return late ? "late" : "duplicate_payment";
}
