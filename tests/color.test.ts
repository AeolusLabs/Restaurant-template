import { describe, expect, test } from "vitest";
import { contrastWithWhite, parseOklch } from "../src/lib/color";
import { parseRestaurantConfig, ConfigError } from "../config/schema";
import { restaurantConfig } from "../config/restaurant";

describe("parseOklch", () => {
  test("reads percentage and plain lightness, with an optional alpha", () => {
    expect(parseOklch("oklch(55% 0.15 40)")).toEqual({ l: 0.55, c: 0.15, h: 40 });
    expect(parseOklch("oklch(0.5 0.1 200)")).toEqual({ l: 0.5, c: 0.1, h: 200 });
    expect(parseOklch("oklch(50% 0.1 200 / 0.5)")).toEqual({ l: 0.5, c: 0.1, h: 200 });
    expect(parseOklch("  OKLCH(50% 0 0)  ")).toEqual({ l: 0.5, c: 0, h: 0 });
  });

  test("returns null for anything else, including other colour syntaxes", () => {
    for (const bad of ["#336699", "rgb(0 0 0)", "red", "oklch(50% 0.1)", "oklch(150% 0.1 20)", "oklch(a b c)", ""]) {
      expect(parseOklch(bad), bad).toBeNull();
    }
  });
});

describe("contrastWithWhite", () => {
  test("is 21 for black and 1 for white", () => {
    expect(contrastWithWhite({ l: 0, c: 0, h: 0 })).toBeCloseTo(21, 1);
    expect(contrastWithWhite({ l: 1, c: 0, h: 0 })).toBeCloseTo(1, 1);
  });

  test("matches the published ratio for pure sRGB red, which is about 4.0:1", () => {
    expect(contrastWithWhite({ l: 0.628, c: 0.2577, h: 29.23 })).toBeCloseTo(4.0, 1);
  });

  test("falls as the colour gets lighter", () => {
    const at = (l: number) => contrastWithWhite({ l, c: 0.1, h: 40 });
    expect(at(0.3)).toBeGreaterThan(at(0.5));
    expect(at(0.5)).toBeGreaterThan(at(0.7));
  });
});

describe("brand colour in config", () => {
  const withColors = (colors: { primary: string; accent: string }) => () => parseRestaurantConfig({ ...restaurantConfig, colors });

  test("the shipped sample colours pass", () => {
    expect(contrastWithWhite(parseOklch(restaurantConfig.colors.primary)!)).toBeGreaterThanOrEqual(4.5);
  });

  test("a primary colour too light for white text is refused, with a way to fix it", () => {
    expect(withColors({ primary: "oklch(80% 0.1 90)", accent: "oklch(70% 0.15 150)" })).toThrow(ConfigError);
    expect(withColors({ primary: "oklch(80% 0.1 90)", accent: "oklch(70% 0.15 150)" })).toThrow(/4\.5:1/);
  });

  test("a colour that is not written as oklch() is refused", () => {
    expect(withColors({ primary: "#b3421b", accent: "oklch(70% 0.15 150)" })).toThrow(/oklch/);
    expect(withColors({ primary: "oklch(45% 0.12 40)", accent: "green" })).toThrow(/oklch/);
  });
});
