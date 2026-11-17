import { describe, expect, test } from "vitest";
import { restaurantConfigSchema } from "../config/schema";
import { restaurantConfig } from "../config/restaurant";

const base = () => structuredClone(restaurantConfig);

describe("restaurant config", () => {
  test("accepts the default config", () => {
    expect(restaurantConfigSchema.safeParse(base()).success).toBe(true);
  });

  test("rejects taxBps above 10000", () => {
    const c = base();
    c.charges.taxBps = 10001;
    expect(restaurantConfigSchema.safeParse(c).success).toBe(false);
  });

  test("rejects negative serviceChargeBps", () => {
    const c = base();
    c.charges.serviceChargeBps = -1;
    expect(restaurantConfigSchema.safeParse(c).success).toBe(false);
  });

  test("rejects a currency exponent outside 0 to 4", () => {
    for (const exponent of [-1, 5, 2.5]) {
      const c = base();
      c.currency.exponent = exponent;
      expect(restaurantConfigSchema.safeParse(c).success).toBe(false);
    }
  });

  test("rejects an unknown IANA timezone", () => {
    const c = base();
    c.timezone = "Mars/Olympus_Mons";
    expect(restaurantConfigSchema.safeParse(c).success).toBe(false);
  });

  test("rejects opening hours where close is not after open", () => {
    const c = base();
    c.openingHours.mon = [{ open: "18:00", close: "09:00" }];
    expect(restaurantConfigSchema.safeParse(c).success).toBe(false);
    c.openingHours.mon = [{ open: "09:00", close: "09:00" }];
    expect(restaurantConfigSchema.safeParse(c).success).toBe(false);
  });

  test("rejects an unknown feature flag key and a non-boolean flag", () => {
    const c = base() as unknown as { features: Record<string, unknown> };
    c.features.promos = "yes";
    expect(restaurantConfigSchema.safeParse(c).success).toBe(false);
  });
});
