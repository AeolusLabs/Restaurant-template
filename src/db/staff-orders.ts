import { and, asc, desc, eq, ilike, inArray, or, type SQL } from "drizzle-orm";
import type { OrderStatus } from "@/domain/orders/statuses";
import { toPublicDelivery, toPublicDropoff, type PublicDropoff, type PublicOrderItem } from "@/lib/sanitize";
import { withRequestContext, type ContextOptions, type RequestContext, type Tx } from "./context";
import { deliveries, orderContacts, orderEvents, orderItems, orders, payments, refunds } from "./schema";

// What staff screens read. Every query runs as the signed-in person, so row-level security decides what they
// may see: the kitchen gets active orders and no phone numbers or payments; managers and owners get everything.

export type OrderRow = typeof orders.$inferSelect;
export type StaffOrder = { order: OrderRow; phone: string | null; items: PublicOrderItem[] };
/** The booking, as managers and owners see it. The kitchen has no access to deliveries. */
export type StaffDelivery = {
  status: string;
  provider: string;
  providerRef: string | null;
  trackingUrl: string | null;
  attempts: number;
  round: number;
  failureReason: string | null;
  feeChargedMinor: number;
  providerCostMinor: number | null;
  nextAttemptAt: Date;
};
export type StaffOrderDetail = StaffOrder & {
  delivery: StaffDelivery | null;
  dropoff: PublicDropoff | null;
  events: { from: OrderStatus | null; to: OrderStatus; actor: string; reason: string | null; at: Date }[];
  payments: { reference: string; provider: string; status: string; amountMinor: number; currency: string; paidAt: Date | null }[];
  refunds: { paymentReference: string; amountMinor: number; status: string; reason: string | null; createdAt: Date }[];
};

export type StaffOrderQuery = { statuses?: OrderStatus[]; search?: string; limit?: number };

/** Makes text safe to use inside an ILIKE pattern, so a search for "%" finds a percent sign, not everything. */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

async function itemsByOrder(tx: Tx, ids: string[]): Promise<Map<string, PublicOrderItem[]>> {
  const map = new Map<string, PublicOrderItem[]>();
  if (ids.length === 0) return map;
  const rows = await tx.select().from(orderItems).where(inArray(orderItems.orderId, ids)).orderBy(asc(orderItems.id));
  for (const r of rows) {
    const list = map.get(r.orderId) ?? [];
    list.push({
      name: r.nameSnapshot,
      quantity: r.quantity,
      unitPriceMinor: r.unitPriceMinorSnapshot,
      modifiers: (r.modifiersSnapshot as { name: string; priceDeltaMinor: number }[]).map((m) => ({ name: m.name, priceDeltaMinor: m.priceDeltaMinor })),
      lineTotalMinor: r.lineTotalMinor,
    });
    map.set(r.orderId, list);
  }
  return map;
}

/** Orders, newest first, with their items. Optionally filtered by status or a search on code and customer name. */
export function listOrdersForStaff(ctx: RequestContext, query: StaffOrderQuery = {}, opts?: ContextOptions): Promise<StaffOrder[]> {
  return withRequestContext(
    ctx,
    async (tx) => {
      const where: SQL[] = [];
      if (query.statuses?.length) where.push(inArray(orders.status, query.statuses));
      const term = query.search?.trim();
      if (term) {
        const pattern = `%${escapeLike(term)}%`;
        where.push(or(ilike(orders.publicCode, pattern), ilike(orders.customerName, pattern))!);
      }
      const rows = await tx
        .select({ order: orders, phone: orderContacts.phone })
        .from(orders)
        .leftJoin(orderContacts, eq(orderContacts.orderId, orders.id))
        .where(and(...where))
        .orderBy(desc(orders.placedAt))
        .limit(Math.min(query.limit ?? 100, 500));
      const items = await itemsByOrder(tx, rows.map((r) => r.order.id));
      return rows.map((r) => ({ order: r.order, phone: r.phone, items: items.get(r.order.id) ?? [] }));
    },
    opts,
  );
}

/** One order with everything a staff member may see about it, or null when there is none they can see. */
export function getOrderForStaff(ctx: RequestContext, publicCode: string, opts?: ContextOptions): Promise<StaffOrderDetail | null> {
  return withRequestContext(
    ctx,
    async (tx) => {
      const [row] = await tx
        .select({ order: orders, phone: orderContacts.phone, address: orderContacts.addressSnapshot })
        .from(orders)
        .leftJoin(orderContacts, eq(orderContacts.orderId, orders.id))
        .where(eq(orders.publicCode, publicCode))
        .limit(1);
      if (!row) return null;
      const id = row.order.id;
      const items = (await itemsByOrder(tx, [id])).get(id) ?? [];
      const [booking] = row.order.fulfilment === "delivery" ? await tx.select().from(deliveries).where(eq(deliveries.orderId, id)) : [];
      const events = await tx.select().from(orderEvents).where(eq(orderEvents.orderId, id)).orderBy(asc(orderEvents.createdAt));
      const pays = await tx.select().from(payments).where(eq(payments.orderId, id)).orderBy(asc(payments.createdAt));
      const refundRows = pays.length
        ? await tx.select().from(refunds).where(inArray(refunds.paymentId, pays.map((p) => p.id))).orderBy(asc(refunds.createdAt))
        : [];
      return {
        order: row.order,
        phone: row.phone,
        items,
        delivery: booking
          ? {
              status: booking.status,
              provider: booking.provider,
              providerRef: booking.providerRef,
              trackingUrl: toPublicDelivery(booking)?.trackingUrl ?? null,
              attempts: booking.attempts,
              round: booking.round,
              failureReason: booking.failureReason,
              feeChargedMinor: booking.feeChargedMinor,
              providerCostMinor: booking.providerCostMinor,
              nextAttemptAt: booking.nextAttemptAt,
            }
          : null,
        dropoff: row.order.fulfilment === "delivery" ? toPublicDropoff(row.address) : null,
        events: events.map((e) => ({ from: e.fromStatus, to: e.toStatus, actor: e.actorType, reason: e.reason, at: e.createdAt })),
        payments: pays.map((p) => ({ reference: p.reference, provider: p.provider, status: p.status, amountMinor: p.amountMinor, currency: p.currency, paidAt: p.paidAt })),
        refunds: refundRows.map((r) => ({
          paymentReference: pays.find((p) => p.id === r.paymentId)?.reference ?? "",
          amountMinor: r.amountMinor,
          status: r.status,
          reason: r.reason,
          createdAt: r.createdAt,
        })),
      };
    },
    opts,
  );
}
