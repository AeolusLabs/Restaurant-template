import { and, eq, inArray } from "drizzle-orm";
import { withSystemContext, type Tx } from "@/db/context";
import { deliveries, orders } from "@/db/schema";
import { transitionOrderIn } from "@/db/transition-order";
import type { OrderStatus } from "@/domain/orders/statuses";
import { providers } from "@/providers";
import type { DeliveryProvider, DeliveryStatus } from "@/providers/delivery/types";
import { failOrder } from "./dispatch";

// Follows a booked delivery to the door. The provider's status (from polling or a webhook) updates the delivery
// row, and the row drives the order: picked up moves it out for delivery, delivered completes it, and a cancelled
// or failed delivery fails the order so a manager can act. Everything here is idempotent, so a repeated poll or
// a replayed webhook changes nothing.

const RANK: Record<string, number> = { queued: -1, pending: 0, awaiting_pickup: 1, in_transit: 2, delivered: 3 };
const FINISHED = ["delivered", "cancelled", "failed"];
const LIVE_ORDER: OrderStatus[] = ["accepted", "preparing", "ready", "out_for_delivery"];

export type SyncDeps = { provider?: DeliveryProvider; systemUrl?: string; onlyOrderIds?: string[] };

/**
 * Records what the provider reported and moves the order to match. Reports that go backwards (an old message
 * arriving late) and statuses we do not know are ignored. Runs inside the caller's system transaction.
 */
export async function applyDeliveryStatus(tx: Tx, deliveryId: string, reported: DeliveryStatus): Promise<void> {
  const [d] = await tx.select().from(deliveries).where(eq(deliveries.id, deliveryId)).for("update");
  if (!d) return;
  const [order] = await tx.select().from(orders).where(eq(orders.id, d.orderId)).for("update");
  if (!order) return;

  let status = d.status;
  if (reported === "cancelled" || reported === "failed") {
    if (!FINISHED.includes(d.status)) status = reported;
  } else if (reported !== "unknown" && d.status !== "queued" && !FINISHED.includes(d.status) && RANK[reported] > (RANK[d.status] ?? -1)) {
    status = reported;
  }
  if (status !== d.status) await tx.update(deliveries).set({ status, updatedAt: new Date() }).where(eq(deliveries.id, d.id));

  let current = order.status;
  const move = async (to: OrderStatus) => {
    await transitionOrderIn(tx, { orderId: order.id, to, actor: { type: "system" }, expectedFrom: current, meta: { delivery: d.providerRef } });
    current = to;
  };

  if (status === "in_transit" || status === "delivered") {
    // The rider can collect before the kitchen marks the order ready. The order only moves from ready.
    if (current === "ready") await move("out_for_delivery");
    if (status === "delivered" && current === "out_for_delivery") await move("completed");
  } else if ((status === "cancelled" || status === "failed") && d.status !== "cancelled" && d.status !== "failed") {
    if (LIVE_ORDER.includes(current)) await failOrder(tx, order.id, "The delivery was cancelled or failed at the provider");
  } else if ((status === "cancelled" || status === "failed") && LIVE_ORDER.includes(current) && d.providerRef) {
    // Already recorded as cancelled on an earlier run, but the order was still live (the move was interrupted).
    await failOrder(tx, order.id, "The delivery was cancelled or failed at the provider");
  }
}

/** Asks the provider about every delivery in flight and applies the answers. */
export async function syncDeliveries(deps: SyncDeps = {}): Promise<{ checked: number; errors: number }> {
  const provider = deps.provider ?? providers().delivery;
  const sys = { url: deps.systemUrl };
  const rows = await withSystemContext(
    (tx) =>
      tx
        .select({ id: deliveries.id, ref: deliveries.providerRef, status: deliveries.status })
        .from(deliveries)
        .innerJoin(orders, eq(orders.id, deliveries.orderId))
        .where(
          and(
            inArray(deliveries.status, ["pending", "awaiting_pickup", "in_transit", "delivered"]),
            inArray(orders.status, LIVE_ORDER),
            deps.onlyOrderIds ? inArray(deliveries.orderId, deps.onlyOrderIds) : undefined,
          ),
        ),
    sys,
  );

  let errors = 0;
  for (const row of rows) {
    if (!row.ref) continue;
    try {
      // A delivery already known to be delivered only needs its order to catch up.
      const reported: DeliveryStatus = row.status === "delivered" ? "delivered" : (await provider.getDelivery(row.ref)).status;
      await withSystemContext((tx) => applyDeliveryStatus(tx, row.id, reported), sys);
    } catch (err) {
      errors++;
      console.error(`delivery sync: left ${row.ref} for the next run`, err instanceof Error ? err.message : err);
    }
  }
  return { checked: rows.length, errors };
}
