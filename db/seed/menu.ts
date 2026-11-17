import { and, eq, inArray } from "drizzle-orm";
import { withSystemContext, type ContextOptions } from "@/db/context";
import { menuCategories, menuItems, modifierGroups, modifiers } from "@/db/schema";

// A small generic menu so the app runs on first boot. Prices are integers in kobo.
// Restaurants replace this through the admin (Phase 3); re-running the seed only restores these rows.
export const SEED_MENU = {
  categories: [
    {
      slug: "mains",
      name: "Mains",
      items: [
        {
          slug: "jollof-rice",
          name: "Jollof Rice",
          description: "Smoky party-style jollof rice.",
          priceMinor: 350_000,
          protein: true,
        },
        { slug: "fried-rice", name: "Fried Rice", description: "Rice stir-fried with vegetables.", priceMinor: 380_000 },
        { slug: "grilled-chicken", name: "Grilled Chicken", description: "Half chicken, grilled to order.", priceMinor: 550_000 },
        { slug: "pepper-soup", name: "Pepper Soup", description: "Spiced broth with your choice of meat.", priceMinor: 450_000 },
      ],
    },
    {
      slug: "drinks",
      name: "Drinks",
      items: [
        { slug: "zobo", name: "Zobo", description: "Chilled hibiscus drink.", priceMinor: 100_000 },
        { slug: "bottled-water", name: "Bottled Water", description: "75cl still water.", priceMinor: 50_000 },
      ],
    },
  ],
  proteinGroup: {
    name: "Add a protein",
    minSelect: 0,
    maxSelect: 1,
    options: [
      { name: "Chicken", priceDeltaMinor: 150_000 },
      { name: "Beef", priceDeltaMinor: 180_000 },
      { name: "Fish", priceDeltaMinor: 200_000 },
    ],
  },
} as const;

/** Idempotent: rows are matched by slug and reset to the seed values. Other rows are left alone. */
export async function seedMenu(opts?: ContextOptions): Promise<{ categories: number; items: number }> {
  return withSystemContext(async (tx) => {
    let items = 0;
    const proteinItemIds: string[] = [];
    for (const [i, cat] of SEED_MENU.categories.entries()) {
      const [category] = await tx
        .insert(menuCategories)
        .values({ slug: cat.slug, name: cat.name, sortOrder: i })
        .onConflictDoUpdate({ target: menuCategories.slug, set: { name: cat.name, sortOrder: i } })
        .returning({ id: menuCategories.id });
      for (const [j, item] of cat.items.entries()) {
        const values = {
          categoryId: category.id,
          slug: item.slug,
          name: item.name,
          description: item.description,
          priceMinor: item.priceMinor,
          sortOrder: j,
        };
        const [row] = await tx
          .insert(menuItems)
          .values(values)
          .onConflictDoUpdate({
            target: menuItems.slug,
            set: { categoryId: values.categoryId, name: values.name, description: values.description, priceMinor: values.priceMinor, sortOrder: j },
          })
          .returning({ id: menuItems.id });
        items++;
        if ("protein" in item && item.protein) proteinItemIds.push(row.id);
      }
    }

    // Modifier groups have no natural key, so the seeded ones are replaced as a set.
    const g = SEED_MENU.proteinGroup;
    if (proteinItemIds.length) {
      await tx.delete(modifierGroups).where(and(inArray(modifierGroups.itemId, proteinItemIds), eq(modifierGroups.name, g.name)));
      for (const itemId of proteinItemIds) {
        const [group] = await tx
          .insert(modifierGroups)
          .values({ itemId, name: g.name, minSelect: g.minSelect, maxSelect: g.maxSelect })
          .returning({ id: modifierGroups.id });
        await tx.insert(modifiers).values(g.options.map((o, k) => ({ groupId: group.id, name: o.name, priceDeltaMinor: o.priceDeltaMinor, sortOrder: k })));
      }
    }
    return { categories: SEED_MENU.categories.length, items };
  }, opts);
}
