import { index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, minor, ts } from "./common";
import { orders } from "./orders";

export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    actorId: uuid("actor_id"),
    actorRole: text("actor_role").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    meta: jsonb("meta").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_created_idx").on(t.createdAt)],
);

/**
 * Things staff must look at: a payment that could not be applied now, a failed delivery and a low delivery
 * wallet later (Phase 4). Managers and owners read and resolve them; only the system raises them.
 */
export const alerts = pgTable(
  "alerts",
  {
    id: id(),
    kind: text("kind").notNull(),
    severity: text("severity").notNull(),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    payload: jsonb("payload").notNull().default({}),
    createdAt: createdAt(),
    resolvedAt: ts("resolved_at"),
    resolvedBy: uuid("resolved_by"),
  },
  (t) => [index("alerts_open_idx").on(t.resolvedAt, t.createdAt)],
);

/**
 * One row per delivery order: the booking with the delivery provider and everything about it. A row starts as
 * `queued` (waiting to be booked, with attempts and next_attempt_at for retries), then follows the provider's
 * status. fee_charged_minor is what the customer paid; provider_cost_minor is what the provider charged.
 */
export const deliveries = pgTable(
  "deliveries",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .unique()
      .references(() => orders.id, { onDelete: "restrict" }),
    provider: text("provider").notNull(),
    providerRef: text("provider_ref"),
    quoteId: text("quote_id"),
    feeChargedMinor: minor("fee_charged_minor").notNull(),
    providerCostMinor: minor("provider_cost_minor"),
    // queued, pending, awaiting_pickup, in_transit, delivered, cancelled, failed or unknown
    status: text("status").notNull().default("queued"),
    trackingUrl: text("tracking_url"),
    failureReason: text("failure_reason"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: ts("next_attempt_at").notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("deliveries_status_idx").on(t.status, t.nextAttemptAt)],
);

/** The delivery provider's prepaid wallet balance, as last checked. */
export const walletSnapshots = pgTable("wallet_snapshots", {
  id: id(),
  balanceMinor: minor("balance_minor").notNull(),
  checkedAt: ts("checked_at").notNull().defaultNow(),
});
