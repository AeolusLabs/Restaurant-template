import { and, asc, eq, inArray, isNull, lte } from "drizzle-orm";
import { restaurantConfig } from "../../config/restaurant";
import type { RestaurantConfig } from "../../config/schema";
import { raiseAlert } from "@/db/alerts";
import { withSystemContext, type Tx } from "@/db/context";
import { deliveries, orderContacts, orders } from "@/db/schema";
import { transitionOrderIn } from "@/db/transition-order";
import type { OrderStatus } from "@/domain/orders/statuses";
import { providers } from "@/providers";
import {
  DuplicateDeliveryError,
  InsufficientWalletError,
  QuoteExpiredError,
  type DeliveryCreated,
  type DeliveryProvider,
  type DeliveryQuoteInput,
} from "@/providers/delivery/types";
import { ensureWalletAlert } from "./wallet";

// Books riders for delivery orders. A delivery is a row in \`deliveries\`; this file turns queued rows into
// bookings. Failures never lose a paid order: a failed attempt is retried with backoff, and after the last
// attempt the order becomes delivery_failed with an alert, for a manager to retry or cancel.

export const MAX_ATTEMPTS = 5;
const BACKOFF_MINUTES = [1, 2, 4, 8];
const LIVE: OrderStatus[] = ["accepted", "preparing", "ready"];

export type DispatchDeps = {
  provider?: DeliveryProvider;
  systemUrl?: string;
  config?: RestaurantConfig;
  now?: Date;
  /** Limit the run to these orders: a manager's retry dispatches just that order, and tests stay apart. */
  onlyOrderIds?: string[];
};

const statusesFrom = (on: RestaurantConfig["delivery"]["dispatchOn"]): OrderStatus[] =>
  on === "accepted" ? ["accepted", "preparing", "ready"] : on === "preparing" ? ["preparing", "ready"] : ["ready"];

/** The restaurant's address as one line, for the rider. */
export const restaurantAddress = (cfg: RestaurantConfig): string =>
  [cfg.address.line1, cfg.address.area, cfg.address.city, cfg.address.country].filter(Boolean).join(", ");

/** Gives every delivery order that has reached the dispatch status a queued delivery. Safe to run repeatedly. */
export async function queueDeliveries(deps: DispatchDeps = {}): Promise<number> {
  const provider = deps.provider ?? providers().delivery;
  const cfg = deps.config ?? restaurantConfig;
  return withSystemContext(
    async (tx) => {
      const rows = await tx
        .select({ id: orders.id, fee: orders.deliveryFeeMinor })
        .from(orders)
        .leftJoin(deliveries, eq(deliveries.orderId, orders.id))
        .where(
          and(
            eq(orders.fulfilment, "delivery"),
            inArray(orders.status, statusesFrom(cfg.delivery.dispatchOn)),
            isNull(deliveries.id),
            deps.onlyOrderIds ? inArray(orders.id, deps.onlyOrderIds) : undefined,
          ),
        );
      if (rows.length === 0) return 0;
      await tx
        .insert(deliveries)
        .values(rows.map((r) => ({ orderId: r.id, provider: provider.name, feeChargedMinor: r.fee })))
        .onConflictDoNothing();
      return rows.length;
    },
    { url: deps.systemUrl },
  );
}

/** A fresh quote, then the booking. If the quote expired in between, one new quote and one more try. */
async function book(provider: DeliveryProvider, trip: DeliveryQuoteInput, reference: string, note: string): Promise<{ created: DeliveryCreated; quoteId: string }> {
  for (let tryNo = 0; ; tryNo++) {
    const quote = await provider.getQuote(trip);
    try {
      return { created: await provider.createDelivery({ ...trip, quoteId: quote.quoteId, reference, note }), quoteId: quote.quoteId };
    } catch (err) {
      if (err instanceof QuoteExpiredError && tryNo === 0) continue;
      throw err;
    }
  }
}

type Outcome = "booked" | "retry" | "failed" | "cancelled" | "skipped";

async function attempt(tx: Tx, id: string, provider: DeliveryProvider, cfg: RestaurantConfig, now: Date): Promise<Outcome> {
  const [d] = await tx
    .select()
    .from(deliveries)
    .where(and(eq(deliveries.id, id), eq(deliveries.status, "queued"), lte(deliveries.nextAttemptAt, now)))
    .for("update", { skipLocked: true });
  if (!d) return "skipped"; // another worker has it, or it is no longer due

  const [order] = await tx.select().from(orders).where(eq(orders.id, d.orderId));
  if (!order || !LIVE.includes(order.status)) {
    await tx.update(deliveries).set({ status: "cancelled", updatedAt: now, failureReason: "order is no longer active" }).where(eq(deliveries.id, d.id));
    return "cancelled";
  }
  const [contact] = await tx.select().from(orderContacts).where(eq(orderContacts.orderId, order.id));
  const where = (contact?.addressSnapshot ?? {}) as { zone?: string; address?: string; landmark?: string };

  const trip: DeliveryQuoteInput = {
    pickup: { name: cfg.name, phone: cfg.contact.phone ?? "", address: restaurantAddress(cfg) },
    dropoff: { name: order.customerName, phone: contact?.phone ?? "", address: [where.address, where.zone].filter(Boolean).join(", ") },
    orderValueMinor: order.subtotalMinor,
  };
  const note = [where.landmark ? `Landmark: ${where.landmark}` : "", order.notes ?? ""].filter(Boolean).join(". ").slice(0, 200);
  const attemptNo = d.attempts + 1;
  const reference = `${order.publicCode}-${attemptNo}`;

  try {
    let result: { created: DeliveryCreated; quoteId: string | null };
    try {
      result = await book(provider, trip, reference, note);
    } catch (err) {
      if (!(err instanceof DuplicateDeliveryError)) throw err;
      // The provider already has this booking (we crashed before recording it): adopt it, do not book twice.
      const existing = await provider.getDelivery(reference);
      result = { created: { providerRef: reference, status: existing.status, costMinor: d.providerCostMinor ?? 0 }, quoteId: null };
    }
    await tx
      .update(deliveries)
      .set({
        status: result.created.status,
        providerRef: result.created.providerRef,
        quoteId: result.quoteId,
        providerCostMinor: result.created.costMinor,
        trackingUrl: result.created.trackingUrl ?? null,
        attempts: attemptNo,
        failureReason: null,
        updatedAt: now,
      })
      .where(eq(deliveries.id, d.id));
    return "booked";
  } catch (err) {
    const reason = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    if (err instanceof InsufficientWalletError) await ensureWalletAlert(tx);
    if (attemptNo < MAX_ATTEMPTS) {
      const delay = BACKOFF_MINUTES[Math.min(attemptNo - 1, BACKOFF_MINUTES.length - 1)];
      await tx
        .update(deliveries)
        .set({ attempts: attemptNo, failureReason: reason, nextAttemptAt: new Date(now.getTime() + delay * 60_000), updatedAt: now })
        .where(eq(deliveries.id, d.id));
      return "retry";
    }
    await tx.update(deliveries).set({ status: "failed", attempts: attemptNo, failureReason: reason, updatedAt: now }).where(eq(deliveries.id, d.id));
    await failOrder(tx, order.id, reason);
    return "failed";
  }
}

/** Moves a paid delivery order to delivery_failed (once) and tells a manager. */
export async function failOrder(tx: Tx, orderId: string, reason: string): Promise<void> {
  const [order] = await tx.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId));
  if (order && [...LIVE, "out_for_delivery"].includes(order.status)) {
    await transitionOrderIn(tx, { orderId, to: "delivery_failed", actor: { type: "system" }, reason: "delivery failed", meta: { reason } });
  }
  await raiseAlert(tx, { kind: "delivery_failed", severity: "critical", orderId, payload: { reason } });
}

/** Books every queued delivery that is due. Safe to run from several workers at once. */
export async function dispatchQueued(deps: DispatchDeps = {}): Promise<{ booked: number; retried: number; failed: number }> {
  const provider = deps.provider ?? providers().delivery;
  const cfg = deps.config ?? restaurantConfig;
  const now = deps.now ?? new Date();
  const sys = { url: deps.systemUrl };

  const due = await withSystemContext(
    (tx) =>
      tx
        .select({ id: deliveries.id })
        .from(deliveries)
        .where(and(eq(deliveries.status, "queued"), lte(deliveries.nextAttemptAt, now), deps.onlyOrderIds ? inArray(deliveries.orderId, deps.onlyOrderIds) : undefined))
        .orderBy(asc(deliveries.nextAttemptAt))
        .limit(20),
    sys,
  );
  const result = { booked: 0, retried: 0, failed: 0 };
  for (const { id } of due) {
    try {
      const outcome = await withSystemContext((tx) => attempt(tx, id, provider, cfg, now), sys);
      if (outcome === "booked") result.booked++;
      else if (outcome === "retry") result.retried++;
      else if (outcome === "failed") result.failed++;
    } catch (err) {
      console.error(`dispatch: left delivery ${id} for the next run`, err instanceof Error ? err.message : err);
    }
  }
  return result;
}
