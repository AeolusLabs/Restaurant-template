import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, minor, ts } from "./common";
import { orders } from "./orders";
import { profiles } from "./profiles";
import { promos } from "./promos";

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
    // Booking attempts in this round. A manager's retry starts a new round, so its references never repeat an old one.
    round: integer("round").notNull().default(1),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: ts("next_attempt_at").notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("deliveries_status_idx").on(t.status, t.nextAttemptAt),
    // A provider reference belongs to one delivery, so a webhook can never match two.
    uniqueIndex("deliveries_provider_ref_unique").on(t.provider, t.providerRef).where(sql`${t.providerRef} is not null`),
  ],
);

/** The delivery provider's prepaid wallet balance, as last checked. */
export const walletSnapshots = pgTable("wallet_snapshots", {
  id: id(),
  balanceMinor: minor("balance_minor").notNull(),
  checkedAt: ts("checked_at").notNull().defaultNow(),
});

/**
 * One row when an order is placed with a promo: who used it, on which order, and what it took off (the waived
 * delivery fee for a free-delivery promo). It counts against the promo's limits until the order is cancelled
 * while still unpaid, when released_at is set by a trigger.
 */
export const promoRedemptions = pgTable(
  "promo_redemptions",
  {
    id: id(),
    promoId: uuid("promo_id")
      .notNull()
      .references(() => promos.id, { onDelete: "restrict" }),
    orderId: uuid("order_id")
      .notNull()
      .unique()
      .references(() => orders.id, { onDelete: "restrict" }),
    // Null once the customer has deleted their account: the redemption stays as a record of what the promo cost.
    profileId: uuid("profile_id").references(() => profiles.id, { onDelete: "set null" }),
    discountMinor: minor("discount_minor").notNull(),
    createdAt: createdAt(),
    releasedAt: ts("released_at"),
  },
  (t) => [index("promo_redemptions_promo_idx").on(t.promoId, t.profileId)],
);
