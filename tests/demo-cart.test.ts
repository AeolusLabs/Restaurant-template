import { describe, expect, test } from "vitest";
import { restaurantConfig } from "../config/restaurant";
import { pickLines } from "../src/domain/demo/cart";
import { priceCart, type PricingItem } from "../src/domain/pricing/price-cart";
import { seededRng } from "../src/lib/rng";

const menu: PricingItem[] = [
  { id: "a", name: "Rice", priceMinor: 350_000, active: true, available: true, groups: [{ id: "g1", name: "Protein", minSelect: 0, maxSelect: 1, modifiers: [{ id: "m1", name: "Chicken", priceDeltaMinor: 150_000, available: true }, { id: "m2", name: "Beef", priceDeltaMinor: 180_000, available: false }] }] },
  { id: "b", name: "Soup", priceMinor: 450_000, active: true, available: true, groups: [{ id: "g2", name: "Heat", minSelect: 1, maxSelect: 1, modifiers: [{ id: "m3", name: "Mild", priceDeltaMinor: 0, available: false }, { id: "m4", name: "Hot", priceDeltaMinor: 0, available: true }] }] },
  { id: "c", name: "Water", priceMinor: 50_000, active: true, available: true, groups: [] },
];

describe("pickLines", () => {
  test("is the same for the same seed, and different for another", () => {
    expect(pickLines(menu, seededRng(1))).toEqual(pickLines(menu, seededRng(1)));
    const many = (seed: number) => JSON.stringify(Array.from({ length: 20 }, (_, i) => pickLines(menu, seededRng(seed + i))));
    expect(many(1)).not.toEqual(many(500));
  });

  test("one to three different dishes, one or two of each", () => {
    for (let s = 0; s < 300; s++) {
      const lines = pickLines(menu, seededRng(s));
      expect(lines.length, `seed ${s}`).toBeGreaterThanOrEqual(1);
      expect(lines.length).toBeLessThanOrEqual(3);
      expect(new Set(lines.map((l) => l.itemId)).size).toBe(lines.length);
      for (const l of lines) expect([1, 2]).toContain(l.quantity);
    }
  });

  test("a required choice is always made, with an option that is available", () => {
    for (let s = 0; s < 300; s++) for (const l of pickLines(menu, seededRng(s)).filter((x) => x.itemId === "b")) expect(l.modifierIds).toEqual(["m4"]);
  });

  test("an optional choice never picks something sold out, and never more than the group allows", () => {
    for (let s = 0; s < 300; s++) for (const l of pickLines(menu, seededRng(s)).filter((x) => x.itemId === "a")) expect(l.modifierIds.every((m) => m === "m1") && l.modifierIds.length <= 1).toBe(true);
  });

  test("every cart it makes can actually be priced and ordered", () => {
    for (let s = 0; s < 300; s++) expect(priceCart(pickLines(menu, seededRng(s)), menu, restaurantConfig.charges).ok, `seed ${s}`).toBe(true);
  });

  test("a menu with one dish still gives one line", () => {
    expect(pickLines([menu[2]], seededRng(3))).toHaveLength(1);
  });
});
