import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { actorType, createdAt, fulfilment, id, minor, orderStatus, ts } from "./common";
import { menuItems } from "./menu";
import { profiles } from "./profiles";

export const orders = pgTable(
  "orders",
  {
    id: id(),
    publicCode: text("public_code").notNull().unique(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "restrict" }),
    customerName: text("customer_name").notNull(),
    status: orderStatus("status").notNull().default("placed"),
    fulfilment: fulfilment("fulfilment").notNull(),
    pickupAt: ts("pickup_at"),
    subtotalMinor: minor("subtotal_minor").notNull(),
    discountMinor: minor("discount_minor").notNull().default(0),
    serviceChargeMinor: minor("service_charge_minor").notNull().default(0),
    taxMinor: minor("tax_minor").notNull().default(0),
    deliveryFeeMinor: minor("delivery_fee_minor").notNull().default(0),
    totalMinor: minor("total_minor").notNull(),
    currency: text("currency").notNull(),
    // Phases 5 and 6 add the promos and qr_sources tables these point at.
    promoId: uuid("promo_id"),
    sourceId: uuid("source_id"),
    resumeState: orderStatus("resume_state"),
    notes: text("notes"),
    expiresAt: ts("expires_at"),
    placedAt: ts("placed_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("orders_profile_idx").on(t.profileId),
    index("orders_status_idx").on(t.status),
    check(
      "orders_money_nonneg",
      sql`${t.subtotalMinor} >= 0 and ${t.discountMinor} >= 0 and ${t.serviceChargeMinor} >= 0 and ${t.taxMinor} >= 0 and ${t.deliveryFeeMinor} >= 0 and ${t.totalMinor} >= 0`,
    ),
  ],
);

export const orderContacts = pgTable("order_contacts", {
  id: id(),
  orderId: uuid("order_id")
    .notNull()
    .unique()
    .references(() => orders.id, { onDelete: "cascade" }),
  phone: text("phone").notNull(),
  addressSnapshot: jsonb("address_snapshot").notNull().default({}),
});

export const orderItems = pgTable(
  "order_items",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    itemId: uuid("item_id").references(() => menuItems.id, { onDelete: "set null" }),
    nameSnapshot: text("name_snapshot").notNull(),
    unitPriceMinorSnapshot: minor("unit_price_minor_snapshot").notNull(),
    quantity: integer("quantity").notNull(),
    modifiersSnapshot: jsonb("modifiers_snapshot").notNull().default([]),
    lineTotalMinor: minor("line_total_minor").notNull(),
  },
  (t) => [
    index("order_items_order_idx").on(t.orderId),
    check("order_items_quantity_positive", sql`${t.quantity} > 0`),
    check("order_items_money_nonneg", sql`${t.unitPriceMinorSnapshot} >= 0 and ${t.lineTotalMinor} >= 0`),
  ],
);

export const orderEvents = pgTable(
  "order_events",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    fromStatus: orderStatus("from_status"),
    toStatus: orderStatus("to_status").notNull(),
    actorType: actorType("actor_type").notNull(),
    actorId: uuid("actor_id"),
    reason: text("reason"),
    meta: jsonb("meta").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("order_events_order_idx").on(t.orderId)],
);

export const orderTransitions = pgTable(
  "order_transitions",
  {
    fromStatus: orderStatus("from_status").notNull(),
    toStatus: orderStatus("to_status").notNull(),
    // 'any', 'pickup' or 'delivery'
    fulfilmentScope: text("fulfilment_scope").notNull().default("any"),
    actors: text("actors").array().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.fromStatus, t.toStatus, t.fulfilmentScope] }),
    check("order_transitions_scope", sql`${t.fulfilmentScope} in ('any', 'pickup', 'delivery')`),
  ],
);
