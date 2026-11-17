import { asc, eq, inArray } from "drizzle-orm";
import { withRequestContext, withSystemContext, type ContextOptions, type RequestContext } from "@/db/context";
import { addresses, consents, dataRequests, orderContacts, orderEvents, orderItems, orders, payments, profiles } from "@/db/schema";

// NDPR / GDPR data export (docs/ARCHITECTURE.md section 14). Every read runs as the customer, so row-level
// security decides what is theirs. The result is built field by field (a whitelist), in plain names, with
// no internal ids, no password data and no tokens.

export type CustomerExport = {
  exportedAt: string;
  account: { email: string; fullName: string; phone: string | null; createdAt: string };
  addresses: { label: string; line1: string; area: string | null; city: string }[];
  consents: { type: string; policyVersion: string; grantedAt: string; withdrawnAt: string | null }[];
  orders: {
    publicCode: string;
    status: string;
    fulfilment: string;
    placedAt: string;
    pickupAt: string | null;
    subtotalMinor: number;
    serviceChargeMinor: number;
    taxMinor: number;
    deliveryFeeMinor: number;
    discountMinor: number;
    totalMinor: number;
    currency: string;
    notes: string | null;
    phone: string | null;
    items: { name: string; quantity: number; unitPriceMinor: number; lineTotalMinor: number; modifiers: { name: string; priceDeltaMinor: number }[] }[];
    events: { from: string | null; to: string; at: string }[];
    payments: { reference: string; status: string; amountMinor: number; currency: string; paidAt: string | null }[];
  }[];
};

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export async function exportCustomerData(
  ctx: RequestContext,
  identity: { email: string },
  opts: { appUrl?: string; systemUrl?: string } = {},
): Promise<CustomerExport> {
  const ro: ContextOptions = { url: opts.appUrl };
  const data = await withRequestContext(
    ctx,
    async (tx): Promise<CustomerExport> => {
      const [profile] = await tx.select().from(profiles).where(eq(profiles.id, ctx.userId));
      const addr = await tx.select().from(addresses).where(eq(addresses.profileId, ctx.userId)).orderBy(asc(addresses.createdAt));
      const cons = await tx.select().from(consents).where(eq(consents.profileId, ctx.userId)).orderBy(asc(consents.grantedAt));
      const ords = await tx.select().from(orders).where(eq(orders.profileId, ctx.userId)).orderBy(asc(orders.placedAt));
      const ids = ords.map((o) => o.id);
      const items = ids.length ? await tx.select().from(orderItems).where(inArray(orderItems.orderId, ids)).orderBy(asc(orderItems.id)) : [];
      const contacts = ids.length ? await tx.select().from(orderContacts).where(inArray(orderContacts.orderId, ids)) : [];
      const events = ids.length ? await tx.select().from(orderEvents).where(inArray(orderEvents.orderId, ids)).orderBy(asc(orderEvents.createdAt)) : [];
      const pays = ids.length ? await tx.select().from(payments).where(inArray(payments.orderId, ids)).orderBy(asc(payments.createdAt)) : [];

      return {
        exportedAt: new Date().toISOString(),
        account: { email: identity.email, fullName: profile?.fullName ?? "", phone: profile?.phone ?? null, createdAt: iso(profile?.createdAt ?? null) ?? "" },
        addresses: addr.map((a) => ({ label: a.label, line1: a.line1, area: a.area, city: a.city })),
        consents: cons.map((c) => ({ type: c.type, policyVersion: c.policyVersion, grantedAt: c.grantedAt.toISOString(), withdrawnAt: iso(c.withdrawnAt) })),
        orders: ords.map((o) => ({
          publicCode: o.publicCode,
          status: o.status,
          fulfilment: o.fulfilment,
          placedAt: o.placedAt.toISOString(),
          pickupAt: iso(o.pickupAt),
          subtotalMinor: o.subtotalMinor,
          serviceChargeMinor: o.serviceChargeMinor,
          taxMinor: o.taxMinor,
          deliveryFeeMinor: o.deliveryFeeMinor,
          discountMinor: o.discountMinor,
          totalMinor: o.totalMinor,
          currency: o.currency,
          notes: o.notes,
          phone: contacts.find((c) => c.orderId === o.id)?.phone ?? null,
          items: items
            .filter((i) => i.orderId === o.id)
            .map((i) => ({
              name: i.nameSnapshot,
              quantity: i.quantity,
              unitPriceMinor: i.unitPriceMinorSnapshot,
              lineTotalMinor: i.lineTotalMinor,
              modifiers: (i.modifiersSnapshot as { name: string; priceDeltaMinor: number }[]).map((m) => ({ name: m.name, priceDeltaMinor: m.priceDeltaMinor })),
            })),
          events: events.filter((e) => e.orderId === o.id).map((e) => ({ from: e.fromStatus, to: e.toStatus, at: e.createdAt.toISOString() })),
          payments: pays
            .filter((p) => p.orderId === o.id)
            .map((p) => ({ reference: p.reference, status: p.status, amountMinor: p.amountMinor, currency: p.currency, paidAt: iso(p.paidAt) })),
        })),
      };
    },
    ro,
  );

  // The app role may only file pending requests, so the completed record is written by the system role.
  await withSystemContext(
    (tx) => tx.insert(dataRequests).values({ profileId: ctx.userId, kind: "export", status: "completed", completedAt: new Date() }),
    { url: opts.systemUrl },
  );
  return data;
}
