import { describe, expect, test } from "vitest";
import { niceCeil, ticks, thinLabels } from "../src/domain/dashboard/scale";
import { moneyCompact } from "../src/lib/format";

describe("niceCeil", () => {
  test("rounds up to 1, 2 or 5 times a power of ten, so the axis ends on a clean number", () => {
    expect(niceCeil(130)).toBe(200);
    expect(niceCeil(450)).toBe(500);
    expect(niceCeil(501)).toBe(1000);
    expect(niceCeil(1_234_567)).toBe(2_000_000);
    expect(niceCeil(7_300_000)).toBe(10_000_000);
  });
  test("a value that is already clean stays", () => {
    for (const v of [1, 2, 5, 10, 200, 500, 1_000_000]) expect(niceCeil(v), String(v)).toBe(v);
  });
  test("nothing, or less than nothing, gives zero", () => {
    expect(niceCeil(0)).toBe(0);
    expect(niceCeil(-5)).toBe(0);
  });
});

describe("ticks", () => {
  test("zero, the middle and the top", () => {
    expect(ticks(500)).toEqual([0, 250, 500]);
    expect(ticks(2_000_000)).toEqual([0, 1_000_000, 2_000_000]);
  });
});

describe("thinLabels", () => {
  test("keeps every label when there are few, and spaces them out when there are many, always keeping the last", () => {
    expect(thinLabels(7, 7)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    const kept = thinLabels(30, 6);
    expect(kept.length).toBeLessThanOrEqual(6);
    expect(kept.at(-1)).toBe(29);
  });
  test("labels are evenly spaced and never closer than the spacing", () => {
    const kept = thinLabels(90, 6);
    const gaps = kept.slice(1).map((v, i) => v - kept[i]);
    expect(new Set(gaps).size).toBe(1);
    expect(kept.at(-1)).toBe(89);
  });
});

describe("moneyCompact", () => {
  test("is short enough for an axis: thousands as K, millions as M, zero as plain zero", () => {
    expect(moneyCompact(1_250_000)).toMatch(/12.5K/);
    expect(moneyCompact(250_000_000)).toMatch(/2.5M/);
    expect(moneyCompact(0)).toMatch(/0$/);
    expect(moneyCompact(1_250_000)).toContain("₦"); // the naira sign, from the configured currency
  });
});
