import { and, eq, isNull } from "drizzle-orm";
import { ForbiddenError } from "@/auth/session";
import { alerts, auditLog, deliveries, orders } from "@/db/schema";
import { raiseAlert } from "@/db/alerts";
import { withRequestContext, withSystemContext, type RequestContext } from "@/db/context";
import { staffTransitionOrder } from "@/db/staff-actions";
import { OrderNotFoundError } from "@/domain/orders/transitions";
import { providers } from "@/providers";
import type { DeliveryProvider } from "@/providers/delivery/types";
import { dispatchQueued, type DispatchDeps } from "./dispatch";

export class DeliveryError extends Error {}

const FINISHED = ["delivered", "cancelled", "failed"];

/**
 * A manager's retry of a failed delivery. The order goes back to where it was (its resume state), the delivery
 * starts a new round with a clean count of attempts and a booking reference no earlier round used, the open
 * alerts for it close, and one booking is tried straight away.
 */
export async function retryDelivery(ctx: RequestContext, publicCode: string, deps: DispatchDeps & { appUrl?: string } = {}): Promise<void> {
  if (ctx.role !== "owner" && ctx.role !== "manager") throw new ForbiddenError("Only owners and managers can retry a delivery");
  const provider = deps.provider ?? providers().delivery;
  const sys = { url: deps.systemUrl };

  const order = await withRequestContext(
    ctx,
    async (tx) => (await tx.select({ id: orders.id, status: orders.status, resume: orders.resumeState }).from(orders).where(eq(orders.publicCode, publicCode)).limit(1))[0],
    { url: deps.appUrl },
  );
  if (!order) throw new OrderNotFoundError("Order not found");
  if (order.status !== "delivery_failed" || !order.resume) throw new DeliveryError("Only an order whose delivery has failed can be retried");

  // Back to where the order was. The database enforces that this is the resume state.
  await staffTransitionOrder(ctx, publicCode, order.resume, { expectedFrom: "delivery_failed", reason: "delivery retried" }, { appUrl: deps.appUrl });

  await withSystemContext(async (tx) => {
    const [d] = await tx.select().from(deliveries).where(eq(deliveries.orderId, order.id)).for("update");
    if (d?.providerRef && !FINISHED.includes(d.status)) await provider.cancel(d.providerRef, "re-booking").catch(() => undefined);
    await tx
      .update(deliveries)
      .set({ status: "queued", round: (d?.round ?? 0) + 1, attempts: 0, providerRef: null, quoteId: null, providerCostMinor: null, trackingUrl: null, failureReason: null, nextAttemptAt: new Date(0), updatedAt: new Date() })
      .where(eq(deliveries.orderId, order.id));
    await tx.update(alerts).set({ resolvedAt: new Date() }).where(and(eq(alerts.orderId, order.id), eq(alerts.kind, "delivery_failed"), isNull(alerts.resolvedAt)));
  }, sys);

  await withRequestContext(
    ctx,
    (tx) => tx.insert(auditLog).values({ actorId: ctx.userId, actorRole: ctx.role, action: "delivery.retry", targetType: "order", targetId: publicCode, meta: { to: order.resume } }),
    { url: deps.appUrl },
  );
  await dispatchQueued({ ...deps, onlyOrderIds: [order.id], now: deps.now ?? new Date() });
}

/**
 * Stops the delivery of an order that is being cancelled: a queued booking is dropped, and a rider already
 * booked is cancelled at the provider. If the provider cannot be reached the order is still cancelled and an
 * alert tells a manager to cancel the rider by hand, because the customer must not wait on Chowdeck.
 */
export async function cancelDeliveryFor(orderId: string, publicCode: string, deps: { provider?: DeliveryProvider; systemUrl?: string } = {}): Promise<void> {
  await withSystemContext(
    async (tx) => {
      const [d] = await tx.select().from(deliveries).where(eq(deliveries.orderId, orderId)).for("update");
      if (!d || FINISHED.includes(d.status)) return;
      if (d.providerRef) {
        try {
          // Resolved only when a rider exists, so pickup orders and unbooked deliveries never touch the provider.
          const provider = deps.provider ?? providers().delivery;
          await provider.cancel(d.providerRef, "Order cancelled by the restaurant");
        } catch (err) {
          console.error(`could not cancel delivery ${d.providerRef}:`, err instanceof Error ? err.message : err);
          await raiseAlert(tx, { kind: "delivery_failed", severity: "critical", orderId, payload: { action: "cancel_rider", reason: "The order was cancelled but the rider could not be cancelled. Cancel it with the delivery provider.", providerRef: d.providerRef, order: publicCode } });
        }
      }
      await tx.update(deliveries).set({ status: "cancelled", failureReason: "order cancelled", updatedAt: new Date() }).where(eq(deliveries.id, d.id));
    },
    { url: deps.systemUrl },
  );
}

