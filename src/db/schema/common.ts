import { sql } from "drizzle-orm";
import { bigint, pgEnum, timestamp, uuid } from "drizzle-orm/pg-core";
import { ACTOR_TYPES, CONSENT_TYPES, FULFILMENTS, ORDER_STATUSES } from "@/domain/orders/statuses";
import { APP_ROLES } from "@/domain/roles";

export const appRole = pgEnum("app_role", APP_ROLES);
export const orderStatus = pgEnum("order_status", ORDER_STATUSES);
export const fulfilment = pgEnum("fulfilment", FULFILMENTS);
export const consentType = pgEnum("consent_type", CONSENT_TYPES);
export const actorType = pgEnum("actor_type", ACTOR_TYPES);
export const dataRequestKind = pgEnum("data_request_kind", ["export", "delete"]);
export const dataRequestStatus = pgEnum("data_request_status", ["pending", "completed", "failed"]);
export const paymentStatus = pgEnum("payment_status", [
  "initiated",
  "succeeded",
  "failed",
  "refunded",
  "partially_refunded",
]);
export const refundStatus = pgEnum("refund_status", ["pending", "succeeded", "failed"]);

export const id = () => uuid("id").primaryKey().default(sql`uuidv7()`);
export const ts = (name: string) => timestamp(name, { withTimezone: true });
export const createdAt = () => ts("created_at").notNull().defaultNow();
/** Money in the minor unit (kobo). bigint, read back as a JS number (safe up to 2^53). */
export const minor = (name: string) => bigint(name, { mode: "number" });
