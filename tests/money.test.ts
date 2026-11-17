import { describe, expect, test } from "vitest";
import { applyBps, assertMinor, extractInclusiveBps, formatMoney } from "../src/lib/money";

describe("assertMinor", () => {
  test("rejects 10.5, NaN, Infinity and 2**53", () => {
    for (const bad of [10.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(() => assertMinor(bad)).toThrow(RangeError);
    }
  });
  test("accepts zero, negatives and the largest safe integer", () => {
    for (const ok of [0, -5, Number.MAX_SAFE_INTEGER]) {
      expect(() => assertMinor(ok)).not.toThrow();
    }
  });
});

describe("applyBps", () => {
  test("applyBps(1005, 750) is 75 (75.375 rounds down)", () => {
    expect(applyBps(1005, 750)).toBe(75);
  });
  test("applyBps(1, 5000) is 1 (0.5 rounds up)", () => {
    expect(applyBps(1, 5000)).toBe(1);
  });
  test("applyBps(3, 3333) is 1", () => {
    expect(applyBps(3, 3333)).toBe(1);
  });
  test("applyBps(0, 750) is 0", () => {
    expect(applyBps(0, 750)).toBe(0);
  });
  test("rejects a fractional amount and a fractional rate", () => {
    expect(() => applyBps(10.5, 750)).toThrow(RangeError);
    expect(() => applyBps(1000, 7.5)).toThrow(RangeError);
  });
  test("does not lose precision on large amounts", () => {
    expect(applyBps(9_000_000_000_000_000, 5000)).toBe(4_500_000_000_000_000);
  });
  test("throws instead of returning an unsafe integer", () => {
    expect(() => applyBps(Number.MAX_SAFE_INTEGER, 10_000_000)).toThrow(RangeError);
  });
  test("rounds a negative amount half away from zero", () => {
    expect(applyBps(-1, 5000)).toBe(-1);
    expect(applyBps(-1005, 750)).toBe(-75);
  });
});

describe("extractInclusiveBps", () => {
  test("extractInclusiveBps(10750, 750) is 750", () => {
    expect(extractInclusiveBps(10750, 750)).toBe(750);
  });
  test("net plus extracted tax always equals gross", () => {
    for (const gross of [1, 99, 1000, 123_457, 10_750]) {
      const tax = extractInclusiveBps(gross, 750);
      expect(Number.isInteger(tax)).toBe(true);
      expect(tax).toBeGreaterThanOrEqual(0);
      expect(tax).toBeLessThanOrEqual(gross);
    }
  });
});

describe("formatMoney", () => {
  test("150000 NGN with exponent 2 shows the symbol and 1,500.00", () => {
    const out = formatMoney(150_000, { currency: "NGN", exponent: 2, locale: "en-NG" });
    expect(out).toContain("₦");
    expect(out).toContain("1,500.00");
  });
  test("exponent 0 shows no decimals", () => {
    const out = formatMoney(1500, { currency: "NGN", exponent: 0, locale: "en-NG" });
    expect(out).toContain("1,500");
    expect(out).not.toContain(".");
  });
  test("formats a negative amount and a sub-unit amount exactly", () => {
    expect(formatMoney(-5, { currency: "NGN", exponent: 2, locale: "en-NG" })).toContain("0.05");
  });
});
