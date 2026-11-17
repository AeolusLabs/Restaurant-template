import { index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { appRole, consentType, createdAt, dataRequestKind, dataRequestStatus, id, ts } from "./common";

export const profiles = pgTable("profiles", {
  id: uuid("id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  role: appRole("role").notNull().default("customer"),
  fullName: text("full_name").notNull(),
  phone: text("phone"),
  blockedAt: ts("blocked_at"),
  deletedAt: ts("deleted_at"),
  createdAt: createdAt(),
});

export const addresses = pgTable(
  "addresses",
  {
    id: id(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    line1: text("line1").notNull(),
    area: text("area"),
    city: text("city").notNull(),
    // Degrees times one million, so no floating point is stored.
    latMicro: integer("lat_micro"),
    lngMicro: integer("lng_micro"),
    createdAt: createdAt(),
  },
  (t) => [index("addresses_profile_idx").on(t.profileId)],
);

export const consents = pgTable(
  "consents",
  {
    id: id(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    type: consentType("type").notNull(),
    policyVersion: text("policy_version").notNull(),
    grantedAt: ts("granted_at").notNull().defaultNow(),
    withdrawnAt: ts("withdrawn_at"),
  },
  (t) => [index("consents_profile_idx").on(t.profileId)],
);

export const dataRequests = pgTable("data_requests", {
  id: id(),
  profileId: uuid("profile_id").references(() => profiles.id, { onDelete: "set null" }),
  kind: dataRequestKind("kind").notNull(),
  status: dataRequestStatus("status").notNull().default("pending"),
  requestedAt: ts("requested_at").notNull().defaultNow(),
  completedAt: ts("completed_at"),
});
