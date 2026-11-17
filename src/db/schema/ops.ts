import { index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, ts } from "./common";
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
