import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, minor, paymentStatus, refundStatus, ts } from "./common";
import { orders } from "./orders";

export const payments = pgTable(
  "payments",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "restrict" }),
    provider: text("provider").notNull(),
    reference: text("reference").notNull().unique(),
    amountMinor: minor("amount_minor").notNull(),
    currency: text("currency").notNull(),
    status: paymentStatus("status").notNull().default("initiated"),
    paidAt: ts("paid_at"),
    createdAt: createdAt(),
  },
  (t) => [index("payments_order_idx").on(t.orderId), check("payments_amount_positive", sql`${t.amountMinor} > 0`)],
);

export const refunds = pgTable(
  "refunds",
  {
    id: id(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id, { onDelete: "restrict" }),
    amountMinor: minor("amount_minor").notNull(),
    reason: text("reason"),
    status: refundStatus("status").notNull().default("pending"),
    providerRef: text("provider_ref"),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
  },
  (t) => [index("refunds_payment_idx").on(t.paymentId), check("refunds_amount_positive", sql`${t.amountMinor} > 0`)],
);

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: id(),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    receivedAt: ts("received_at").notNull().defaultNow(),
    processedAt: ts("processed_at"),
  },
  (t) => [unique("webhook_events_provider_event_unique").on(t.provider, t.eventId)],
);
