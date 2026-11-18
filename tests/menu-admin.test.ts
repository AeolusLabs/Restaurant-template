import { sql } from "drizzle-orm";
import { afterAll, describe, expect, inject, test } from "vitest";
import { ForbiddenError } from "../src/auth/session";
import { closePools, withRequestContext } from "../src/db/context";
import { loadMenu } from "../src/db/menu";
import * as admin_ from "../src/db/menu-admin";
import { groupProblem, slugify } from "../src/domain/menu/rules";
import { admin, closeFixtures, makeUser } from "./helpers/fixtures";

const urls = inject("dbUrls");
const o = { url: urls.app };
const tag = `ma${Date.now().toString(36)}`;
afterAll(async () => {
  await closePools();
  await closeFixtures();
});

const manager = async () => (await makeUser("manager")).ctx;
const audits = async (action: string, target: string) => (await admin().query(`select actor_role, meta from audit_log where action = $1 and target_id = $2`, [action, target])).rows;
const customerMenu = async () => (await loadMenu(o)).filter((c) => c.slug.startsWith(tag));

describe("slugify", () => {
  test("makes a short readable lower-case slug", () => {
    expect(slugify("Jollof Rice & Chicken!")).toBe("jollof-rice-chicken");
    expect(slugify("  Café  Crème ")).toBe("cafe-creme");
    expect(slugify("!!!")).toBe("item");
  });
});

describe("groupProblem", () => {
  const g = (min: number, max: number, available: number, total = available) => ({
    minSelect: min,
    maxSelect: max,
    modifiers: [...Array(total)].map((_, i) => ({ id: String(i), name: "m", priceDeltaMinor: 0, available: i < available })),
  });
  test("a group that can always be satisfied has no problem", () => {
    expect(groupProblem(g(0, 1, 0))).toBeNull();
    expect(groupProblem(g(1, 1, 2))).toBeNull();
    expect(groupProblem(g(2, 3, 3))).toBeNull();
  });
  test("says plainly when customers cannot satisfy the group", () => {
    expect(groupProblem(g(1, 1, 0))).toMatch(/needs at least 1/i);
    expect(groupProblem(g(2, 2, 1, 3))).toMatch(/only 1 available/i);
  });
});

describe("categories and items", () => {
  test("a manager builds a category and an item, and the customer menu shows them", async () => {
    const ctx = await manager();
    const cat = await admin_.createCategory(ctx, { name: `${tag} Starters` }, o);
    const item = await admin_.createItem(ctx, { categoryId: cat.id, name: "Suya", description: "Spiced beef skewers", priceMinor: 350_050 }, o);
    expect(item.slug).toMatch(/^suya/);
    const menu = await customerMenu();
    expect(menu).toHaveLength(1);
    expect(menu[0].items[0]).toMatchObject({ name: "Suya", priceMinor: 350_050, available: true });
  });

  test("two items with the same name get different slugs", async () => {
    const ctx = await manager();
    const cat = await admin_.createCategory(ctx, { name: `${tag} Dupes` }, o);
    const a = await admin_.createItem(ctx, { categoryId: cat.id, name: `${tag} Twin`, priceMinor: 100 }, o);
    const b = await admin_.createItem(ctx, { categoryId: cat.id, name: `${tag} Twin`, priceMinor: 100 }, o);
    expect(a.slug).not.toBe(b.slug);
  });

  test("price, name and sold-out changes show up for customers straight away", async () => {
    const ctx = await manager();
    const cat = await admin_.createCategory(ctx, { name: `${tag} Mains` }, o);
    const item = await admin_.createItem(ctx, { categoryId: cat.id, name: "Rice", priceMinor: 100_000 }, o);
    await admin_.updateItem(ctx, item.id, { name: "Jollof Rice", priceMinor: 120_000 }, o);
    await admin_.setItemAvailable(ctx, item.id, false, o);
    const shown = (await customerMenu()).find((c) => c.name === `${tag} Mains`)!.items[0];
    expect(shown).toMatchObject({ name: "Jollof Rice", priceMinor: 120_000, available: false });
  });

  test("archiving an item hides it from customers but keeps it for staff, and archiving a category hides its items", async () => {
    const ctx = await manager();
    const cat = await admin_.createCategory(ctx, { name: `${tag} Gone` }, o);
    const item = await admin_.createItem(ctx, { categoryId: cat.id, name: "Old special", priceMinor: 1 }, o);
    await admin_.updateItem(ctx, item.id, { active: false }, o);
    expect((await customerMenu()).some((c) => c.name === `${tag} Gone`)).toBe(false);
    const staffView = (await admin_.loadAdminMenu(ctx, o)).find((c) => c.id === cat.id)!;
    expect(staffView.items.map((i) => [i.name, i.active])).toEqual([["Old special", false]]);

    await admin_.updateItem(ctx, item.id, { active: true }, o);
    await admin_.updateCategory(ctx, cat.id, { active: false }, o);
    expect((await customerMenu()).some((c) => c.name === `${tag} Gone`)).toBe(false);
    expect((await admin_.loadAdminMenu(ctx, o)).some((c) => c.id === cat.id && !c.active)).toBe(true);
  });

  test("rejects a missing name, a negative or fractional price, and an item in no category", async () => {
    const ctx = await manager();
    const cat = await admin_.createCategory(ctx, { name: `${tag} Checks` }, o);
    await expect(admin_.createItem(ctx, { categoryId: cat.id, name: "  ", priceMinor: 1 }, o)).rejects.toThrow();
    await expect(admin_.createItem(ctx, { categoryId: cat.id, name: "x", priceMinor: -1 }, o)).rejects.toThrow();
    await expect(admin_.createItem(ctx, { categoryId: cat.id, name: "x", priceMinor: 1.5 }, o)).rejects.toThrow();
    await expect(admin_.createItem(ctx, { categoryId: "00000000-0000-7000-8000-000000000000", name: "x", priceMinor: 1 }, o)).rejects.toThrow();
  });

  test("every change is audited with who and what", async () => {
    const ctx = await manager();
    const cat = await admin_.createCategory(ctx, { name: `${tag} Audit` }, o);
    const item = await admin_.createItem(ctx, { categoryId: cat.id, name: "Tea", priceMinor: 100 }, o);
    await admin_.updateItem(ctx, item.id, { priceMinor: 200 }, o);
    expect((await audits("menu.item.create", item.id)).length).toBe(1);
    const upd = await audits("menu.item.update", item.id);
    expect(upd).toEqual([{ actor_role: "manager", meta: { fields: ["priceMinor"] } }]);
  });
});

describe("who may edit the menu", () => {
  test("kitchen and customers are refused, and may only read", async () => {
    const mgr = await manager();
    const cat = await admin_.createCategory(mgr, { name: `${tag} Locked` }, o);
    const item = await admin_.createItem(mgr, { categoryId: cat.id, name: "Tea", priceMinor: 100 }, o);
    for (const role of ["kitchen", "customer"] as const) {
      const { ctx } = await makeUser(role);
      await expect(admin_.createCategory(ctx, { name: "x" }, o), role).rejects.toBeInstanceOf(ForbiddenError);
      await expect(admin_.updateItem(ctx, item.id, { priceMinor: 1 }, o), role).rejects.toBeInstanceOf(ForbiddenError);
      await expect(admin_.setItemAvailable(ctx, item.id, false, o), role).rejects.toBeInstanceOf(ForbiddenError);
    }
    const kitchen = (await makeUser("kitchen")).ctx;
    expect((await admin_.loadAdminMenu(kitchen, o)).some((c) => c.id === cat.id)).toBe(true);
    await expect(admin_.loadAdminMenu((await makeUser("customer")).ctx, o)).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("and the database says no on its own: a direct update as the kitchen changes nothing", async () => {
    const mgr = await manager();
    const cat = await admin_.createCategory(mgr, { name: `${tag} Backstop` }, o);
    const item = await admin_.createItem(mgr, { categoryId: cat.id, name: "Tea", priceMinor: 100 }, o);
    const kitchen = (await makeUser("kitchen")).ctx;
    await withRequestContext(kitchen, (tx) => tx.execute(sql`update menu_items set price_minor = 1 where id = ${item.id}::uuid`), o);
    expect((await admin().query(`select price_minor::int as p from menu_items where id = $1`, [item.id])).rows[0].p).toBe(100);
  });
});

describe("modifier groups and modifiers", () => {
  test("a manager adds a group and choices, and customers see them in order", async () => {
    const ctx = await manager();
    const cat = await admin_.createCategory(ctx, { name: `${tag} Mods` }, o);
    const item = await admin_.createItem(ctx, { categoryId: cat.id, name: "Burger", priceMinor: 450_000 }, o);
    const group = await admin_.createGroup(ctx, item.id, { name: "Size", minSelect: 1, maxSelect: 1 }, o);
    await admin_.createModifier(ctx, group.id, { name: "Regular", priceDeltaMinor: 0 }, o);
    const large = await admin_.createModifier(ctx, group.id, { name: "Large", priceDeltaMinor: 100_000 }, o);
    const shown = (await customerMenu()).find((c) => c.name === `${tag} Mods`)!.items[0];
    expect(shown.groups[0].modifiers.map((m) => [m.name, m.priceDeltaMinor])).toEqual([["Regular", 0], ["Large", 100_000]]);

    await admin_.updateModifier(ctx, large.id, { available: false }, o);
    expect((await customerMenu()).find((c) => c.name === `${tag} Mods`)!.items[0].groups[0].modifiers[1].available).toBe(false);

    await admin_.deleteModifier(ctx, large.id, o);
    expect((await customerMenu()).find((c) => c.name === `${tag} Mods`)!.items[0].groups[0].modifiers).toHaveLength(1);
    await admin_.deleteGroup(ctx, group.id, o);
    expect((await customerMenu()).find((c) => c.name === `${tag} Mods`)!.items[0].groups).toEqual([]);
  });

  test("refuses a group whose maximum is below its minimum, and a negative price change", async () => {
    const ctx = await manager();
    const cat = await admin_.createCategory(ctx, { name: `${tag} Bad` }, o);
    const item = await admin_.createItem(ctx, { categoryId: cat.id, name: "x", priceMinor: 1 }, o);
    await expect(admin_.createGroup(ctx, item.id, { name: "g", minSelect: 2, maxSelect: 1 }, o)).rejects.toThrow();
    const group = await admin_.createGroup(ctx, item.id, { name: "g", minSelect: 0, maxSelect: 1 }, o);
    await expect(admin_.createModifier(ctx, group.id, { name: "m", priceDeltaMinor: -5 }, o)).rejects.toThrow();
  });

  test("the staff menu lists groups that customers could never satisfy", async () => {
    const ctx = await manager();
    const cat = await admin_.createCategory(ctx, { name: `${tag} Health` }, o);
    const item = await admin_.createItem(ctx, { categoryId: cat.id, name: "x", priceMinor: 1 }, o);
    await admin_.createGroup(ctx, item.id, { name: "Required but empty", minSelect: 1, maxSelect: 1 }, o);
    const found = (await admin_.loadAdminMenu(ctx, o)).find((c) => c.id === cat.id)!.items[0];
    expect(found.groups[0].modifiers).toEqual([]);
    expect(groupProblem(found.groups[0])).toMatch(/needs at least 1/i);
  });
});

describe("ordering", () => {
  test("moving an item up or down swaps it with its neighbour and tidies the numbering", async () => {
    const ctx = await manager();
    const cat = await admin_.createCategory(ctx, { name: `${tag} Order` }, o);
    const [a, b, c] = [
      await admin_.createItem(ctx, { categoryId: cat.id, name: "A", priceMinor: 1 }, o),
      await admin_.createItem(ctx, { categoryId: cat.id, name: "B", priceMinor: 1 }, o),
      await admin_.createItem(ctx, { categoryId: cat.id, name: "C", priceMinor: 1 }, o),
    ];
    const names = async () => (await admin_.loadAdminMenu(ctx, o)).find((x) => x.id === cat.id)!.items.map((i) => i.name);
    expect(await names()).toEqual(["A", "B", "C"]);
    await admin_.moveItem(ctx, c.id, "up", o);
    expect(await names()).toEqual(["A", "C", "B"]);
    await admin_.moveItem(ctx, a.id, "up", o); // already first: no change
    expect(await names()).toEqual(["A", "C", "B"]);
    await admin_.moveItem(ctx, a.id, "down", o);
    expect(await names()).toEqual(["C", "A", "B"]);
    void b;
  });

  test("categories reorder the same way", async () => {
    const ctx = await manager();
    const x = await admin_.createCategory(ctx, { name: `${tag} Zz1` }, o);
    const y = await admin_.createCategory(ctx, { name: `${tag} Zz2` }, o);
    const order = async () => (await admin_.loadAdminMenu(ctx, o)).filter((c) => c.id === x.id || c.id === y.id).map((c) => c.id);
    expect(await order()).toEqual([x.id, y.id]);
    await admin_.moveCategory(ctx, y.id, "up", o);
    expect(await order()).toEqual([y.id, x.id]);
  });
});
