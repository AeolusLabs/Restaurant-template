import { and, asc, eq, inArray, type SQL } from "drizzle-orm";
import type { PricingGroup, PricingItem } from "@/domain/pricing/price-cart";
import { withPublicContext, type ContextOptions, type Tx } from "./context";
import { menuCategories, menuItems, modifierGroups, modifiers } from "./schema";

// Read model for the customer site. Menu rows are public by design (RLS lets anyone read active ones),
// so the storefront reads through withPublicContext. Everything here is a plain whitelist of columns.

export type MenuItem = PricingItem & { slug: string; description: string | null; categoryId: string; imageKey: string | null; sortOrder: number };
export type MenuCategory = { id: string; slug: string; name: string; items: MenuItem[] };

export type Row = {
  item: typeof menuItems.$inferSelect;
  category: { id: string; slug: string; name: string };
};

export async function readItems(tx: Tx, where: SQL | undefined): Promise<Row[]> {
  return tx
    .select({
      item: menuItems,
      category: { id: menuCategories.id, slug: menuCategories.slug, name: menuCategories.name },
    })
    .from(menuItems)
    .innerJoin(menuCategories, eq(menuItems.categoryId, menuCategories.id))
    .where(where)
    .orderBy(asc(menuCategories.sortOrder), asc(menuCategories.name), asc(menuItems.sortOrder), asc(menuItems.name));
}

export async function attachGroups(tx: Tx, rows: Row[]): Promise<MenuItem[]> {
  if (rows.length === 0) return [];
  const groups = await tx
    .select()
    .from(modifierGroups)
    .where(inArray(modifierGroups.itemId, rows.map((r) => r.item.id)))
    .orderBy(asc(modifierGroups.sortOrder), asc(modifierGroups.name));
  const mods =
    groups.length === 0
      ? []
      : await tx
          .select()
          .from(modifiers)
          .where(inArray(modifiers.groupId, groups.map((g) => g.id)))
          .orderBy(asc(modifiers.sortOrder), asc(modifiers.name));

  const byGroup = new Map<string, PricingGroup["modifiers"]>();
  for (const m of mods) {
    const list = byGroup.get(m.groupId) ?? [];
    list.push({ id: m.id, name: m.name, priceDeltaMinor: m.priceDeltaMinor, available: m.available });
    byGroup.set(m.groupId, list);
  }
  const byItem = new Map<string, PricingGroup[]>();
  for (const g of groups) {
    const list = byItem.get(g.itemId) ?? [];
    list.push({ id: g.id, name: g.name, minSelect: g.minSelect, maxSelect: g.maxSelect, modifiers: byGroup.get(g.id) ?? [] });
    byItem.set(g.itemId, list);
  }
  return rows.map(({ item }) => ({
    id: item.id,
    slug: item.slug,
    name: item.name,
    description: item.description,
    priceMinor: item.priceMinor,
    active: item.active,
    available: item.available,
    categoryId: item.categoryId,
    imageKey: item.imageKey,
    sortOrder: item.sortOrder,
    groups: byItem.get(item.id) ?? [],
  }));
}

const storefront = and(eq(menuItems.active, true), eq(menuCategories.active, true));

/** The whole customer-facing menu: active categories with their active items. Sold-out items stay listed. */
export function loadMenu(opts?: ContextOptions): Promise<MenuCategory[]> {
  return withPublicContext(async (tx) => {
    const rows = await readItems(tx, storefront);
    const items = await attachGroups(tx, rows);
    const categories: MenuCategory[] = [];
    rows.forEach((row, i) => {
      let cat = categories.at(-1);
      if (!cat || cat.id !== row.category.id) {
        cat = { ...row.category, items: [] };
        categories.push(cat);
      }
      cat.items.push(items[i]);
    });
    return categories;
  }, opts);
}

/** One active item by its slug, or null when it is unknown, retired, or in a hidden category. */
export function loadMenuItem(slug: string, opts?: ContextOptions): Promise<{ item: MenuItem; categoryName: string } | null> {
  return withPublicContext(async (tx) => {
    const rows = await readItems(tx, and(storefront, eq(menuItems.slug, slug)));
    if (rows.length === 0) return null;
    const [item] = await attachGroups(tx, rows);
    return { item, categoryName: rows[0].category.name };
  }, opts);
}

/**
 * The items a cart refers to, in the shape priceCart needs, read inside the caller's transaction so the
 * caller's role decides what is visible. A retired item is invisible to a customer, so it reads as not found.
 */
export async function loadPricingItems(tx: Tx, itemIds: readonly string[]): Promise<MenuItem[]> {
  if (itemIds.length === 0) return [];
  return attachGroups(tx, await readItems(tx, inArray(menuItems.id, [...itemIds])));
}
