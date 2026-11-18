import { describe, expect, test } from "vitest";
import { MAX_LINE_QUANTITY, priceCart, type PricingItem } from "../src/domain/pricing/price-cart";

const burger: PricingItem = {
  id: "item-burger",
  name: "Burger",
  priceMinor: 450_000,
  active: true,
  available: true,
  groups: [
    {
      id: "g-size",
      name: "Size",
      minSelect: 1,
      maxSelect: 1,
      modifiers: [
        { id: "m-reg", name: "Regular", priceDeltaMinor: 0, available: true },
        { id: "m-large", name: "Large", priceDeltaMinor: 100_000, available: true },
        { id: "m-gone", name: "Jumbo", priceDeltaMinor: 200_000, available: false },
      ],
    },
    {
      id: "g-extra",
      name: "Extras",
      minSelect: 0,
      maxSelect: 2,
      modifiers: [
        { id: "m-cheese", name: "Cheese", priceDeltaMinor: 30_000, available: true },
        { id: "m-bacon", name: "Bacon", priceDeltaMinor: 50_000, available: true },
        { id: "m-egg", name: "Egg", priceDeltaMinor: 25_000, available: true },
      ],
    },
  ],
};
const water: PricingItem = { id: "item-water", name: "Water", priceMinor: 50_000, active: true, available: true, groups: [] };
const soldOut: PricingItem = { ...water, id: "item-sold", name: "Sold out", available: false };
const retired: PricingItem = { ...water, id: "item-retired", name: "Retired", active: false };
const menu = [burger, water, soldOut, retired];

const none = { serviceChargeBps: 0, taxBps: 0, pricesIncludeCharges: false };
const price = (lines: Parameters<typeof priceCart>[0], charges = none) => priceCart(lines, menu, charges);

describe("priceCart: lines", () => {
  test("prices an item from the menu, with modifier deltas, and snapshots names and prices", () => {
    const r = price([{ itemId: "item-burger", quantity: 2, modifierIds: ["m-large", "m-cheese"] }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lines).toEqual([
      {
        itemId: "item-burger",
        name: "Burger",
        quantity: 2,
        unitPriceMinor: 580_000,
        modifiers: [
          { id: "m-large", name: "Large", priceDeltaMinor: 100_000 },
          { id: "m-cheese", name: "Cheese", priceDeltaMinor: 30_000 },
        ],
        lineTotalMinor: 1_160_000,
      },
    ]);
    expect(r.subtotalMinor).toBe(1_160_000);
  });

  test("sums several lines", () => {
    const r = price([
      { itemId: "item-water", quantity: 3, modifierIds: [] },
      { itemId: "item-burger", quantity: 1, modifierIds: ["m-reg"] },
    ]);
    expect(r.ok && r.subtotalMinor).toBe(150_000 + 450_000);
  });

  test("an empty cart is a problem, not a zero-value order", () => {
    expect(price([])).toEqual({ ok: false, problems: [{ index: -1, code: "empty_cart" }] });
  });

  test("keeps exact integers for the largest quantity at a large price", () => {
    const big: PricingItem = { ...water, id: "item-big", priceMinor: 9_000_000_000_000 };
    const r = priceCart([{ itemId: "item-big", quantity: MAX_LINE_QUANTITY, modifierIds: [] }], [big], none);
    expect(r.ok && r.subtotalMinor).toBe(9_000_000_000_000 * MAX_LINE_QUANTITY);
  });
});

describe("priceCart: problems are reported per line", () => {
  const codes = (lines: Parameters<typeof priceCart>[0]) => {
    const r = price(lines);
    return r.ok ? [] : r.problems.map((p) => [p.index, p.code]);
  };

  test("unknown, retired and sold-out items", () => {
    expect(
      codes([
        { itemId: "nope", quantity: 1, modifierIds: [] },
        { itemId: "item-retired", quantity: 1, modifierIds: [] },
        { itemId: "item-sold", quantity: 1, modifierIds: [] },
        { itemId: "item-water", quantity: 1, modifierIds: [] },
      ]),
    ).toEqual([
      [0, "not_found"],
      [1, "inactive"],
      [2, "sold_out"],
    ]);
  });

  test("quantity must be a whole number from 1 to the maximum", () => {
    expect(
      codes([
        { itemId: "item-water", quantity: 0, modifierIds: [] },
        { itemId: "item-water", quantity: -1, modifierIds: [] },
        { itemId: "item-water", quantity: 1.5, modifierIds: [] },
        { itemId: "item-water", quantity: MAX_LINE_QUANTITY + 1, modifierIds: [] },
      ]),
    ).toEqual([
      [0, "quantity"],
      [1, "quantity"],
      [2, "quantity"],
      [3, "quantity"],
    ]);
  });

  test("a modifier that belongs to another item, an unknown one, or a repeated one is invalid", () => {
    expect(
      codes([
        { itemId: "item-water", quantity: 1, modifierIds: ["m-cheese"] },
        { itemId: "item-burger", quantity: 1, modifierIds: ["m-reg", "unknown"] },
        { itemId: "item-burger", quantity: 1, modifierIds: ["m-reg", "m-cheese", "m-cheese"] },
      ]),
    ).toEqual([
      [0, "modifier_invalid"],
      [1, "modifier_invalid"],
      [2, "modifier_invalid"],
    ]);
  });

  test("an unavailable modifier is reported as unavailable", () => {
    expect(codes([{ itemId: "item-burger", quantity: 1, modifierIds: ["m-gone"] }])).toEqual([[0, "modifier_unavailable"]]);
  });

  test("selection counts must respect each group's minimum and maximum", () => {
    expect(
      codes([
        { itemId: "item-burger", quantity: 1, modifierIds: [] }, // size is required
        { itemId: "item-burger", quantity: 1, modifierIds: ["m-reg", "m-large"] }, // size allows one
        { itemId: "item-burger", quantity: 1, modifierIds: ["m-reg", "m-cheese", "m-bacon", "m-egg"] }, // extras allow two
        { itemId: "item-burger", quantity: 1, modifierIds: ["m-reg", "m-cheese", "m-bacon"] }, // fine
      ]),
    ).toEqual([
      [0, "selection_count"],
      [1, "selection_count"],
      [2, "selection_count"],
    ]);
  });

  test("any problem means no price is returned at all", () => {
    const r = price([
      { itemId: "item-water", quantity: 1, modifierIds: [] },
      { itemId: "nope", quantity: 1, modifierIds: [] },
    ]);
    expect(r.ok).toBe(false);
    expect("subtotalMinor" in r).toBe(false);
  });
});

describe("priceCart: charges", () => {
  const lines = [{ itemId: "item-water", quantity: 20, modifierIds: [] }]; // subtotal 1,000,000

  test("exclusive: service charge on the subtotal, tax on subtotal plus service charge", () => {
    const r = price(lines, { serviceChargeBps: 500, taxBps: 750, pricesIncludeCharges: false });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.subtotalMinor).toBe(1_000_000);
    expect(r.serviceChargeMinor).toBe(50_000);
    expect(r.taxMinor).toBe(78_750); // 7.5% of 1,050,000
    expect(r.totalMinor).toBe(1_128_750);
  });

  test("inclusive: the total equals the subtotal and the charges are the portions inside it", () => {
    const r = price(lines, { serviceChargeBps: 500, taxBps: 750, pricesIncludeCharges: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.totalMinor).toBe(1_000_000);
    expect(r.taxMinor).toBe(69_767); // 1,000,000 - round(1,000,000 / 1.075)
    expect(r.serviceChargeMinor).toBe(44_297); // 930,233 - round(930,233 / 1.05)
    expect(r.taxMinor + r.serviceChargeMinor).toBeLessThan(r.totalMinor);
  });

  test("rounds half up", () => {
    // 5% of 10 minor units is 0.5, which rounds up to 1.
    const tiny: PricingItem = { ...water, id: "item-tiny", priceMinor: 10 };
    const r = priceCart([{ itemId: "item-tiny", quantity: 1, modifierIds: [] }], [tiny], { serviceChargeBps: 500, taxBps: 0, pricesIncludeCharges: false });
    expect(r.ok && r.serviceChargeMinor).toBe(1);
  });

  test("zero rates add nothing in either mode", () => {
    for (const pricesIncludeCharges of [true, false]) {
      const r = price(lines, { serviceChargeBps: 0, taxBps: 0, pricesIncludeCharges });
      expect(r.ok && [r.serviceChargeMinor, r.taxMinor, r.totalMinor]).toEqual([0, 0, 1_000_000]);
    }
  });
});

describe("priceCart: delivery fee", () => {
  const lines = [{ itemId: "item-water", quantity: 20, modifierIds: [] }]; // subtotal 1,000,000

  test("is added to the total after charges, and is never taxed", () => {
    const r = priceCart(lines, menu, { serviceChargeBps: 500, taxBps: 750, pricesIncludeCharges: false }, 150_000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.deliveryFeeMinor).toBe(150_000);
    expect(r.taxMinor).toBe(78_750); // unchanged by the fee
    expect(r.totalMinor).toBe(1_128_750 + 150_000);
  });

  test("with prices including charges, the total is the subtotal plus the fee", () => {
    const r = priceCart(lines, menu, { serviceChargeBps: 500, taxBps: 750, pricesIncludeCharges: true }, 150_000);
    expect(r.ok && r.totalMinor).toBe(1_150_000);
  });

  test("defaults to no fee, and refuses one that is negative or not whole", () => {
    expect((priceCart(lines, menu, none) as { deliveryFeeMinor: number }).deliveryFeeMinor).toBe(0);
    expect(() => priceCart(lines, menu, none, -1)).toThrow(RangeError);
    expect(() => priceCart(lines, menu, none, 1.5)).toThrow(RangeError);
  });
});
