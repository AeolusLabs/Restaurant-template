import { describe, expect, test } from "vitest";
import { ConfigError, parseRestaurantConfig, restaurantConfigSchema } from "../config/schema";
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

describe("parseRestaurantConfig", () => {
  test("an invalid config stops boot with a message that names each bad field", () => {
    const c = base();
    c.charges.taxBps = 20_000;
    c.currency.exponent = 9;
    expect(() => parseRestaurantConfig(c)).toThrow(ConfigError);
    expect(() => parseRestaurantConfig(c)).toThrow(/charges\.taxBps/);
    expect(() => parseRestaurantConfig(c)).toThrow(/currency\.exponent/);
    expect(() => parseRestaurantConfig(c)).toThrow(/config\/restaurant\.ts/);
  });

  test("a valid config is returned as is", () => {
    expect(parseRestaurantConfig(base())).toEqual(restaurantConfig);
  });
});

describe("delivery config", () => {
  test("a low wallet threshold is required and cannot be negative", () => {
    const c = base() as unknown as { delivery: { lowWalletMinor?: number } };
    expect(restaurantConfig.delivery.lowWalletMinor).toBeGreaterThan(0);
    c.delivery.lowWalletMinor = -1;
    expect(restaurantConfigSchema.safeParse(c).success).toBe(false);
    delete c.delivery.lowWalletMinor;
    expect(restaurantConfigSchema.safeParse(c).success).toBe(false);
  });

  test("turning delivery on requires at least one zone and a restaurant phone number (the rider is given it)", () => {
    const on = () => {
      const c = base();
      c.features.delivery = true;
      return c;
    };
    expect(restaurantConfigSchema.safeParse(on()).success).toBe(true);
    const noZones = on();
    noZones.delivery.zones = [];
    expect(restaurantConfigSchema.safeParse(noZones).success).toBe(false);
    const noPhone = on();
    noPhone.contact.phone = undefined;
    expect(restaurantConfigSchema.safeParse(noPhone).success).toBe(false);
  });

  test("with delivery off, none of that is required", () => {
    const c = base();
    c.features.delivery = false;
    c.delivery.zones = [];
    c.contact.phone = undefined;
    expect(restaurantConfigSchema.safeParse(c).success).toBe(true);
  });

  test("zone names are unique, because the customer picks by name", () => {
    const c = base();
    c.delivery.zones = [
      { name: "Island", feeMinor: 1 },
      { name: "Island", feeMinor: 2 },
    ];
    expect(restaurantConfigSchema.safeParse(c).success).toBe(false);
  });
});
