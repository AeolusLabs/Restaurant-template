import { describe, expect, test } from "vitest";
import { applyBps, assertMinor, extractInclusiveBps, formatMoney, moneyInputValue, parseMoneyInput } from "../src/lib/money";

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


describe("parseMoneyInput", () => {
  test("reads whole and decimal amounts exactly, in the minor unit", () => {
    expect(parseMoneyInput("3500", 2)).toBe(350_000);
    expect(parseMoneyInput("3500.5", 2)).toBe(350_050);
    expect(parseMoneyInput("3500.50", 2)).toBe(350_050);
    expect(parseMoneyInput("0.01", 2)).toBe(1);
    expect(parseMoneyInput("0", 2)).toBe(0);
    expect(parseMoneyInput(".5", 2)).toBe(50);
  });

  test("accepts thousands commas and surrounding spaces", () => {
    expect(parseMoneyInput(" 3,500.50 ", 2)).toBe(350_050);
    expect(parseMoneyInput("1,234,567", 2)).toBe(123_456_700);
  });

  test("works for currencies with no decimals or three", () => {
    expect(parseMoneyInput("500", 0)).toBe(500);
    expect(parseMoneyInput("1.250", 3)).toBe(1_250);
  });

  test("refuses too many decimals instead of rounding", () => {
    expect(parseMoneyInput("3500.555", 2)).toBeNull();
    expect(parseMoneyInput("5.5", 0)).toBeNull();
  });

  test("refuses negatives, words, exponents, empty input and malformed commas", () => {
    for (const bad of ["-1", "abc", "1e3", "", "  ", "12,34", "1,,000", ",5", "3500.", "1.2.3", "₦3500", "NaN"]) {
      expect(parseMoneyInput(bad, 2), JSON.stringify(bad)).toBeNull();
    }
  });

  test("refuses an amount too large to hold exactly", () => {
    expect(parseMoneyInput("90071992547409.92", 2)).toBeNull();
    expect(parseMoneyInput("90071992547409", 2)).toBe(9_007_199_254_740_900);
  });
});

describe("moneyInputValue", () => {
  test("writes the minor unit as a plain amount a person can edit", () => {
    expect(moneyInputValue(350_050, 2)).toBe("3500.50");
    expect(moneyInputValue(350_000, 2)).toBe("3500.00");
    expect(moneyInputValue(1, 2)).toBe("0.01");
    expect(moneyInputValue(500, 0)).toBe("500");
  });

  test("round trips", () => {
    for (const minor of [0, 1, 99, 100, 123_456_789]) expect(parseMoneyInput(moneyInputValue(minor, 2), 2)).toBe(minor);
  });
});
