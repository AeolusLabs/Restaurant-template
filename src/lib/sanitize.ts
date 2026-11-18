import { APP_ROLES, type AppRole } from "@/domain/roles";

// The single definition of "safe to return" for a person. Never hand-roll another destructure:
// route every user or profile row through toPublicUser() before it reaches a response.
// This is a whitelist, so a column added to a table later is private until it is listed here.

export type PublicOrderItem = {
  name: string;
  quantity: number;
  unitPriceMinor: number;
  modifiers: { name: string; priceDeltaMinor: number }[];
  lineTotalMinor: number;
};

/** What a customer may know of their delivery: how far it has got and where to follow it. Nothing about the provider. */
export type PublicDelivery = { status: string; trackingUrl: string | null };
export type PublicDropoff = { zone: string; address: string; landmark: string | null };

/** Only a web address is ever offered to a customer as a link. */
const webUrl = (u: unknown): string | null => {
  if (typeof u !== "string") return null;
  try {
    const p = new URL(u).protocol;
    return p === "https:" || p === "http:" ? u : null;
  } catch {
    return null;
  }
};

export function toPublicDelivery(row: { status: string; trackingUrl: string | null } | undefined): PublicDelivery | null {
  return row ? { status: row.status, trackingUrl: webUrl(row.trackingUrl) } : null;
}

/** The delivery address the customer typed, from the order's contact snapshot. */
export function toPublicDropoff(snapshot: unknown): PublicDropoff | null {
  const s = (snapshot ?? {}) as { zone?: unknown; address?: unknown; landmark?: unknown };
  if (typeof s.zone !== "string" || typeof s.address !== "string") return null;
  return { zone: s.zone, address: s.address, landmark: typeof s.landmark === "string" ? s.landmark : null };
}

export type PublicOrder = {
  publicCode: string;
  status: string;
  fulfilment: string;
  pickupAt: string | null;
  subtotalMinor: number;
  discountMinor: number;
  serviceChargeMinor: number;
  taxMinor: number;
  deliveryFeeMinor: number;
  totalMinor: number;
  currency: string;
  notes: string | null;
  placedAt: string;
  expiresAt: string | null;
  items: PublicOrderItem[];
  /** Null for a pickup order, and for a delivery order that has not been booked yet. */
  delivery: PublicDelivery | null;
  dropoff: PublicDropoff | null;
};

const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : typeof v === "string" ? v : null);

/** The customer-facing view of an order. A whitelist: internal ids, the owner and contact details are not in it. */
export function toPublicOrder(
  row: Record<string, unknown> | object,
  items: PublicOrderItem[] = [],
  extra: { delivery?: PublicDelivery | null; dropoff?: PublicDropoff | null } = {},
): PublicOrder {
  const r = row as Record<string, unknown>;
  const num = (k: string): number => {
    const v = r[k];
    if (typeof v !== "number") throw new TypeError(`toPublicOrder: ${k} must be a number`);
    return v;
  };
  const text = (k: string): string => {
    const v = r[k];
    if (typeof v !== "string") throw new TypeError(`toPublicOrder: ${k} must be a string`);
    return v;
  };
  return {
    publicCode: text("publicCode"),
    status: text("status"),
    fulfilment: text("fulfilment"),
    pickupAt: iso(r.pickupAt),
    subtotalMinor: num("subtotalMinor"),
    discountMinor: num("discountMinor"),
    serviceChargeMinor: num("serviceChargeMinor"),
    taxMinor: num("taxMinor"),
    deliveryFeeMinor: num("deliveryFeeMinor"),
    totalMinor: num("totalMinor"),
    currency: text("currency"),
    notes: typeof r.notes === "string" ? r.notes : null,
    placedAt: iso(r.placedAt) ?? "",
    expiresAt: iso(r.expiresAt),
    items: items.map((i) => ({
      name: i.name,
      quantity: i.quantity,
      unitPriceMinor: i.unitPriceMinor,
      modifiers: i.modifiers.map((m) => ({ name: m.name, priceDeltaMinor: m.priceDeltaMinor })),
      lineTotalMinor: i.lineTotalMinor,
    })),
    delivery: extra.delivery ?? null,
    dropoff: extra.dropoff ?? null,
  };
}

export type StaffOrderJson = {
  publicCode: string;
  status: string;
  fulfilment: string;
  customerName: string;
  phone: string | null;
  notes: string | null;
  pickupAt: string | null;
  placedAt: string;
  totalMinor: number;
  items: PublicOrderItem[];
};

/** The view of an order sent to staff screens over JSON. A whitelist: no owner id, no internal ids. */
export function toStaffOrder(row: Record<string, unknown> | object, items: PublicOrderItem[], phone: string | null): StaffOrderJson {
  const base = toPublicOrder(row, items);
  const r = row as Record<string, unknown>;
  return {
    publicCode: base.publicCode,
    status: base.status,
    fulfilment: base.fulfilment,
    customerName: typeof r.customerName === "string" ? r.customerName : "",
    phone,
    notes: base.notes,
    pickupAt: base.pickupAt,
    placedAt: base.placedAt,
    totalMinor: base.totalMinor,
    items: base.items,
  };
}

export type PublicUser = { id: string; name: string; email: string; role: AppRole };

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

export function toPublicUser(row: unknown): PublicUser {
  if (typeof row !== "object" || row === null) throw new TypeError("toPublicUser expects an object");
  const r = row as Record<string, unknown>;
  const id = str(r.id);
  if (!id) throw new TypeError("toPublicUser: row has no id");
  const role = r.role;
  if (typeof role !== "string" || !(APP_ROLES as readonly string[]).includes(role)) {
    throw new TypeError("toPublicUser: row has no valid role (merge the profile into the row first)");
  }
  return {
    id,
    name: str(r.name) ?? str(r.fullName) ?? str(r.full_name) ?? "",
    email: str(r.email) ?? "",
    role: role as AppRole,
  };
}
