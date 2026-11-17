import { afterAll, beforeAll, describe, expect, inject, test } from "vitest";
import { closePools, withRequestContext } from "../src/db/context";
import { loadMenu, loadMenuItem, loadPricingItems } from "../src/db/menu";
import { admin, closeFixtures, makeUser } from "./helpers/fixtures";

const urls = inject("dbUrls");
const opts = { url: urls.app };
const tag = `mr${Date.now().toString(36)}`;

const ids: Record<string, string> = {};

beforeAll(async () => {
  const q = async (sql: string, params: unknown[]): Promise<string> => (await admin().query(sql, params)).rows[0].id as string;
  ids.catA = await q(`insert into menu_categories (slug, name, sort_order) values ($1, 'B Mains', 20) returning id`, [`${tag}-a`]);
  ids.catB = await q(`insert into menu_categories (slug, name, sort_order) values ($1, 'A Starters', 10) returning id`, [`${tag}-b`]);
  ids.catOff = await q(`insert into menu_categories (slug, name, active) values ($1, 'Hidden category', false) returning id`, [`${tag}-off`]);
  const item = (cat: string, slug: string, name: string, price: number, extra = "") =>
    q(`insert into menu_items (category_id, slug, name, price_minor, description ${extra ? ", " + extra.split("=")[0] : ""}) values ($1, $2, $3, $4, 'Tasty' ${extra ? ", " + extra.split("=")[1] : ""}) returning id`, [cat, slug, name, price]);
  ids.burger = await item(ids.catA, `${tag}-burger`, "Burger", 450_000);
  ids.soldOut = await item(ids.catA, `${tag}-soldout`, "Ribs", 900_000, "available=false");
  ids.retired = await item(ids.catA, `${tag}-retired`, "Old special", 100_000, "active=false");
  ids.soup = await item(ids.catB, `${tag}-soup`, "Soup", 150_000);
  ids.inHiddenCat = await item(ids.catOff, `${tag}-ghost`, "Ghost", 100_000);

  ids.groupSize = await q(`insert into modifier_groups (item_id, name, min_select, max_select, sort_order) values ($1, 'Size', 1, 1, 1) returning id`, [ids.burger]);
  ids.groupExtra = await q(`insert into modifier_groups (item_id, name, min_select, max_select, sort_order) values ($1, 'Extras', 0, 2, 2) returning id`, [ids.burger]);
  await admin().query(
    `insert into modifiers (group_id, name, price_delta_minor, sort_order, available) values
       ($1, 'Large', 100000, 2, true), ($1, 'Regular', 0, 1, true), ($2, 'Cheese', 30000, 1, false)`,
    [ids.groupSize, ids.groupExtra],
  );
});

afterAll(async () => {
  await closePools();
  await closeFixtures();
});

describe("loadMenu", () => {
  const mine = async () => (await loadMenu(opts)).filter((c) => c.slug.startsWith(tag));

  test("lists active categories with active items, ordered by sort order", async () => {
    const menu = await mine();
    expect(menu.map((c) => c.name)).toEqual(["A Starters", "B Mains"]);
    expect(menu[1].items.map((i) => i.name)).toEqual(["Burger", "Ribs"]); // active only, by name
  });

  test("keeps a sold-out item on the menu but flags it", async () => {
    const ribs = (await mine())[1].items.find((i) => i.name === "Ribs")!;
    expect(ribs.available).toBe(false);
  });

  test("never lists a retired item or an item in a hidden category", async () => {
    const names = (await mine()).flatMap((c) => c.items.map((i) => i.name));
    expect(names).not.toContain("Old special");
    expect(names).not.toContain("Ghost");
  });

  test("attaches modifier groups and modifiers in order, with prices as numbers", async () => {
    const burger = (await mine())[1].items.find((i) => i.name === "Burger")!;
    expect(burger.priceMinor).toBe(450_000);
    expect(burger.groups.map((g) => [g.name, g.minSelect, g.maxSelect])).toEqual([
      ["Size", 1, 1],
      ["Extras", 0, 2],
    ]);
    expect(burger.groups[0].modifiers.map((m) => [m.name, m.priceDeltaMinor, m.available])).toEqual([
      ["Regular", 0, true],
      ["Large", 100_000, true],
    ]);
    expect(burger.groups[1].modifiers[0]).toMatchObject({ name: "Cheese", available: false });
  });
});

describe("loadMenuItem", () => {
  test("finds an active item by slug, with its category name", async () => {
    const found = await loadMenuItem(`${tag}-burger`, opts);
    expect(found?.item.name).toBe("Burger");
    expect(found?.categoryName).toBe("B Mains");
  });

  test("returns null for an unknown slug, a retired item and an item in a hidden category", async () => {
    for (const slug of ["no-such-item", `${tag}-retired`, `${tag}-ghost`]) {
      expect(await loadMenuItem(slug, opts), slug).toBeNull();
    }
  });
});

describe("loadPricingItems", () => {
  test("returns the items a customer's request can see, in the shape the pricing code needs", async () => {
    const { ctx } = await makeUser("customer");
    const items = await withRequestContext(ctx, (tx) => loadPricingItems(tx, [ids.burger, ids.retired, ids.soldOut]), opts);
    expect(items.map((i) => i.name).sort()).toEqual(["Burger", "Ribs"]); // the retired item is invisible to customers
    const burger = items.find((i) => i.name === "Burger")!;
    expect(burger).toMatchObject({ id: ids.burger, priceMinor: 450_000, active: true, available: true });
    expect(burger.groups).toHaveLength(2);
    expect(items.find((i) => i.name === "Ribs")!.available).toBe(false);
  });

  test("an empty id list returns nothing without querying", async () => {
    const { ctx } = await makeUser("customer");
    expect(await withRequestContext(ctx, (tx) => loadPricingItems(tx, []), opts)).toEqual([]);
  });
});
