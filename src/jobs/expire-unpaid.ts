import { and, eq, lte } from "drizzle-orm";
import { withSystemContext } from "@/db/context";
import { orders, payments } from "@/db/schema";
import { transitionOrderIn } from "@/db/transition-order";
import { settlePayment } from "@/payments/apply-payment";
import type { PaymentProvider } from "@/providers/payment/types";

export type ExpireDeps = { provider?: PaymentProvider; systemUrl?: string; now?: Date; batch?: number };
export type ExpireResult = { expired: number; paid: number; skipped: number };

type One = "expired" | "paid" | "noop";

/**
 * Cancels unpaid orders whose time ran out (config.orders.unpaidExpiryMinutes). It never cancels an order
 * without first asking the provider about each open payment attempt: a payment the webhook missed is applied
 * (the order becomes paid) instead of being cancelled. If the provider cannot be reached the order is left
 * alone and tried again on the next run. Safe to run repeatedly and from several workers.
 */
export async function expireUnpaidOrders(deps: ExpireDeps = {}): Promise<ExpireResult> {
  const provider = deps.provider ?? (await import("@/providers")).providers().payment;
  const now = deps.now ?? new Date();
  const sys = { url: deps.systemUrl };

  const due = await withSystemContext(
    (tx) =>
      tx
        .select({ id: orders.id })
        .from(orders)
        .where(and(eq(orders.status, "placed"), lte(orders.expiresAt, now)))
        .limit(deps.batch ?? 100),
    sys,
  );

  const result: ExpireResult = { expired: 0, paid: 0, skipped: 0 };
  for (const { id } of due) {
    try {
      const one = await withSystemContext(async (tx): Promise<One> => {
        const [order] = await tx.select().from(orders).where(eq(orders.id, id)).for("update");
        if (!order || order.status !== "placed" || !order.expiresAt || order.expiresAt.getTime() > now.getTime()) return "noop";

        const open = await tx
          .select({ reference: payments.reference })
          .from(payments)
          .where(and(eq(payments.orderId, id), eq(payments.status, "initiated")));
        for (const { reference } of open) {
          if ((await settlePayment(tx, reference, provider)) === "paid") return "paid";
        }
        await tx.update(payments).set({ status: "failed" }).where(and(eq(payments.orderId, id), eq(payments.status, "initiated")));
        await transitionOrderIn(tx, { orderId: id, to: "cancelled", actor: { type: "system" }, expectedFrom: "placed", reason: "unpaid expiry" });
        return "expired";
      }, sys);
      if (one === "expired") result.expired++;
      else if (one === "paid") result.paid++;
    } catch (err) {
      result.skipped++;
      console.error(`expire-unpaid: left order ${id} for the next run`, err instanceof Error ? err.message : err);
    }
  }
  return result;
}
