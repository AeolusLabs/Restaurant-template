import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, minor, ts } from "./common";

/**
 * Promo codes. `value` is basis points for a percentage, kobo for a fixed amount, and null for free delivery.
 * Managers and owners write them; customers never read this table (a code is looked up by promo_for_code()).
 * Promos are switched off, never deleted, so a past order's promo_id always points at something.
 */
export const promos = pgTable(
  "promos",
  {
    id: id(),
    code: text("code").notNull().unique(),
    description: text("description").notNull().default(""),
    kind: text("kind").notNull(),
    value: minor("value"),
    minOrderMinor: minor("min_order_minor").notNull().default(0),
    maxDiscountMinor: minor("max_discount_minor"),
    startsAt: ts("starts_at"),
    expiresAt: ts("expires_at"),
    maxRedemptions: integer("max_redemptions"),
    maxPerCustomer: integer("max_per_customer"),
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("promos_kind_check", sql`${t.kind} in ('percent', 'fixed', 'free_delivery')`),
    check(
      "promos_value_check",
      // A check passes when it is NULL, so each branch says outright whether value must be present.
      sql`(${t.kind} = 'percent' and ${t.value} is not null and ${t.value} between 1 and 10000) or (${t.kind} = 'fixed' and ${t.value} is not null and ${t.value} > 0) or (${t.kind} = 'free_delivery' and ${t.value} is null)`,
    ),
    check("promos_code_check", sql`${t.code} ~ '^[A-Z0-9_-]{3,20}$'`),
    check("promos_limits_check", sql`${t.minOrderMinor} >= 0 and (${t.maxDiscountMinor} is null or ${t.maxDiscountMinor} > 0) and (${t.maxRedemptions} is null or ${t.maxRedemptions} > 0) and (${t.maxPerCustomer} is null or ${t.maxPerCustomer} > 0)`),
    check("promos_window_check", sql`${t.startsAt} is null or ${t.expiresAt} is null or ${t.expiresAt} > ${t.startsAt}`),
  ],
);
