import { describe, expect, test } from "vitest";
import { MAX_CART_LINES, cartSchema, lineKey } from "../src/domain/checkout/cart";
import { CODE_ALPHABET, CODE_LENGTH, generatePublicCode } from "../src/domain/orders/public-code";
import { MAX_LINE_QUANTITY } from "../src/domain/pricing/price-cart";

const A = "0194f3c0-0000-7000-8000-00000000000a";
const B = "0194f3c0-0000-7000-8000-00000000000b";
const line = (over: Record<string, unknown> = {}) => ({ itemId: A, quantity: 1, modifierIds: [], ...over });

describe("cartSchema", () => {
  test("accepts a valid cart and defaults modifierIds to none", () => {
    expect(cartSchema.parse([{ itemId: A, quantity: 2 }, line({ itemId: B, modifierIds: [A] })])).toEqual([
      { itemId: A, quantity: 2, modifierIds: [] },
      { itemId: B, quantity: 1, modifierIds: [A] },
    ]);
  });

  test("drops fields the server never trusts, such as a price, a total or a status", () => {
    const parsed = cartSchema.parse([line({ price: 1, priceMinor: 1, unitPriceMinor: 1, total: 1, status: "paid" })]);
    expect(parsed).toEqual([{ itemId: A, quantity: 1, modifierIds: [] }]);
  });

  test("rejects an empty cart and a cart over the line limit", () => {
    expect(cartSchema.safeParse([]).success).toBe(false);
    expect(cartSchema.safeParse(Array.from({ length: MAX_CART_LINES }, () => line())).success).toBe(true);
    expect(cartSchema.safeParse(Array.from({ length: MAX_CART_LINES + 1 }, () => line())).success).toBe(false);
  });

  test("rejects quantities that are not whole numbers from 1 to the maximum", () => {
    for (const quantity of [0, -1, 1.5, MAX_LINE_QUANTITY + 1, Number.NaN, Infinity, "2"]) {
      expect(cartSchema.safeParse([line({ quantity })]).success, String(quantity)).toBe(false);
    }
    expect(cartSchema.safeParse([line({ quantity: MAX_LINE_QUANTITY })]).success).toBe(true);
  });

  test("rejects ids that are not UUIDs, and input that is not an array", () => {
    expect(cartSchema.safeParse([line({ itemId: "burger" })]).success).toBe(false);
    expect(cartSchema.safeParse([line({ modifierIds: ["cheese"] })]).success).toBe(false);
    expect(cartSchema.safeParse({ itemId: A, quantity: 1 }).success).toBe(false);
    expect(cartSchema.safeParse(null).success).toBe(false);
  });
});

describe("lineKey", () => {
  test("is the same for the same item and modifiers in any order, and differs otherwise", () => {
    expect(lineKey({ itemId: A, modifierIds: [A, B] })).toBe(lineKey({ itemId: A, modifierIds: [B, A] }));
    expect(lineKey({ itemId: A, modifierIds: [B] })).not.toBe(lineKey({ itemId: A, modifierIds: [] }));
    expect(lineKey({ itemId: A, modifierIds: [] })).not.toBe(lineKey({ itemId: B, modifierIds: [] }));
  });
});

describe("generatePublicCode", () => {
  test("is six characters from an alphabet with no look-alikes (0 O 1 I)", () => {
    expect(CODE_LENGTH).toBe(6);
    expect(CODE_ALPHABET).not.toMatch(/[01OI]/);
    for (let i = 0; i < 500; i++) expect(generatePublicCode()).toMatch(/^[2-9A-HJ-NP-Z]{6}$/);
  });

  test("uses the random source it is given, one draw per character", () => {
    const draws: number[] = [];
    const code = generatePublicCode((max) => {
      draws.push(max);
      return draws.length - 1;
    });
    expect(draws).toEqual(Array(6).fill(CODE_ALPHABET.length));
    expect(code).toBe([...CODE_ALPHABET].slice(0, 6).join(""));
  });

  test("does not repeat across a thousand draws", () => {
    expect(new Set(Array.from({ length: 1000 }, () => generatePublicCode())).size).toBe(1000);
  });
});
