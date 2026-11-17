import { eq } from "drizzle-orm";
import { withRequestContext, type RequestContext } from "@/db/context";
import { cancelUnpaidOrder } from "@/db/orders";
import { orders } from "@/db/schema";
import { transitionOrder } from "@/db/transition-order";
import { IllegalTransitionError, OrderNotFoundError } from "@/domain/orders/transitions";
import { RefundError, refundOrder, type RefundDeps } from "./refund";

/**
 * A customer cancels their own order. Unpaid: simply cancelled. Paid but not yet accepted: cancelled and
 * refunded by the system. Once the restaurant has accepted it, the customer cannot cancel on their own.
 * If the refund cannot be made the order is still cancelled and `refunded` is false (an alert is raised).
 */
export async function cancelMyOrder(ctx: RequestContext, publicCode: string, deps: RefundDeps = {}): Promise<{ refunded: boolean }> {
  const current = await withRequestContext(
    ctx,
    async (tx) => (await tx.select({ id: orders.id, status: orders.status }).from(orders).where(eq(orders.publicCode, publicCode)).limit(1))[0],
    { url: deps.appUrl },
  );
  if (!current) throw new OrderNotFoundError("Order not found");

  if (current.status === "placed") {
    await cancelUnpaidOrder(ctx, publicCode, { appUrl: deps.appUrl });
    return { refunded: false };
  }
  if (current.status !== "paid") {
    throw new IllegalTransitionError("The restaurant has already started on this order. Please contact them to cancel it.");
  }

  await transitionOrder(
    { orderId: current.id, to: "cancelled", actor: { type: "customer", id: ctx.userId }, expectedFrom: "paid", reason: "customer cancelled" },
    { appUrl: deps.appUrl },
  );
  try {
    await refundOrder({ type: "system" }, publicCode, { ...deps, reason: "customer cancelled" });
    return { refunded: true };
  } catch (err) {
    if (err instanceof RefundError) return { refunded: false };
    throw err;
  }
}
