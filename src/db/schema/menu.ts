import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, minor } from "./common";

export const menuCategories = pgTable("menu_categories", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const menuItems = pgTable(
  "menu_items",
  {
    id: id(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => menuCategories.id, { onDelete: "restrict" }),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    priceMinor: minor("price_minor").notNull(),
    imageKey: text("image_key"),
    available: boolean("available").notNull().default(true),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index("menu_items_category_idx").on(t.categoryId),
    check("menu_items_price_nonneg", sql`${t.priceMinor} >= 0`),
  ],
);

export const modifierGroups = pgTable(
  "modifier_groups",
  {
    id: id(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => menuItems.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    minSelect: integer("min_select").notNull().default(0),
    maxSelect: integer("max_select").notNull().default(1),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [
    index("modifier_groups_item_idx").on(t.itemId),
    check("modifier_groups_bounds", sql`${t.minSelect} >= 0 and ${t.maxSelect} >= ${t.minSelect}`),
  ],
);

export const modifiers = pgTable(
  "modifiers",
  {
    id: id(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => modifierGroups.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    priceDeltaMinor: minor("price_delta_minor").notNull().default(0),
    available: boolean("available").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (t) => [index("modifiers_group_idx").on(t.groupId)],
);
