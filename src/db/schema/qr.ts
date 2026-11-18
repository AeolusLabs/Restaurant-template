import { sql } from "drizzle-orm";
import { boolean, check, index, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, ts } from "./common";

/**
 * A place the restaurant advertises: a flyer, a table card, a delivery bag. Its QR code holds <site>/q/<slug>.
 * Managers and owners write them; customers never read this table. Switched off, never deleted, so an order's
 * source_id always points at something.
 */
export const qrSources = pgTable(
  "qr_sources",
  {
    id: id(),
    slug: text("slug").notNull().unique(),
    label: text("label").notNull(),
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("qr_sources_slug_check", sql`${t.slug} ~ '^[abcdefghjkmnpqrstuvwxyz23456789]{8}$'`),
    check("qr_sources_label_check", sql`char_length(btrim(${t.label})) between 1 and 120`),
  ],
);

/** One row per visit to a code's address. No person, address or browser: a source and a time. */
export const qrScans = pgTable(
  "qr_scans",
  {
    id: id(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => qrSources.id, { onDelete: "restrict" }),
    scannedAt: ts("scanned_at").notNull().defaultNow(),
  },
  (t) => [index("qr_scans_source_idx").on(t.sourceId, t.scannedAt)],
);
