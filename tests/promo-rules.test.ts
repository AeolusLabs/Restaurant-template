import { describe, expect, test } from "vitest";
import { applyPromo, normalizeCode, promoRejection, promoText, type Promo } from "../src/domain/promos/rules";

const base: Promo = {
  code: "WELCOME10",
  kind: "percent",
  value: 1000, // 10%
  minOrderMinor: 0,
  maxDiscountMinor: null,
  active: true,
  startsAt: null,
  expiresAt: null,
  maxRedemptions: null,
  maxPerCustomer: 1,
};
const promo = (over: Partial<Promo> = {}): Promo => ({ ...base, ...over });
const NOW = new Date("2026-11-18T12:00:00Z");
const ctx = (over: Partial<Parameters<typeof promoRejection>[1]> = {}) => ({ now: NOW, usage: { total: 0, mine: 0 }, fulfilment: "pickup" as const, ...over });

describe("normalizeCode", () => {
  test("upper-cases and trims, so a code is matched without regard to case", () => {
    expect(normalizeCode("  welcome10 ")).toBe("WELCOME10");
    expect(normalizeCode("Free-Del_1")).toBe("FREE-DEL_1");
  });
  test("refuses anything that is not 3 to 20 letters, digits, hyphens or underscores", () => {
    for (const bad of ["", "ab", "a".repeat(21), "has space", "emoji\u{1F600}", "semi;colon", "quote'", "%"]) expect(normalizeCode(bad), bad).toBeNull();
  });
});

describe("promoRejection", () => {
  test("a live promo with room left is accepted", () => {
    expect(promoRejection(promo(), ctx())).toBeNull();
  });
  test("switched off, not started, expired", () => {
    expect(promoRejection(promo({ active: false }), ctx())).toBe("inactive");
    expect(promoRejection(promo({ startsAt: new Date("2026-11-19T00:00:00Z") }), ctx())).toBe("not_started");
    expect(promoRejection(promo({ expiresAt: new Date("2026-11-18T11:59:59Z") }), ctx())).toBe("expired");
  });
  test("the start is inclusive and the expiry is exclusive", () => {
    expect(promoRejection(promo({ startsAt: NOW }), ctx())).toBeNull();
    expect(promoRejection(promo({ expiresAt: NOW }), ctx())).toBe("expired");
  });
  test("a total limit is used up when the count reaches it, and none means unlimited", () => {
    expect(promoRejection(promo({ maxRedemptions: 5 }), ctx({ usage: { total: 4, mine: 0 } }))).toBeNull();
    expect(promoRejection(promo({ maxRedemptions: 5 }), ctx({ usage: { total: 5, mine: 0 } }))).toBe("used_up");
    expect(promoRejection(promo({ maxRedemptions: null }), ctx({ usage: { total: 99_999, mine: 0 } }))).toBeNull();
  });
  test("a per-customer limit stops the same person using it again", () => {
    expect(promoRejection(promo({ maxPerCustomer: 1 }), ctx({ usage: { total: 1, mine: 1 } }))).toBe("already_used");
    expect(promoRejection(promo({ maxPerCustomer: 2 }), ctx({ usage: { total: 1, mine: 1 } }))).toBeNull();
    expect(promoRejection(promo({ maxPerCustomer: null }), ctx({ usage: { total: 9, mine: 9 } }))).toBeNull();
  });
  test("free delivery is for delivery orders only", () => {
    const free = promo({ kind: "free_delivery", value: null });
    expect(promoRejection(free, ctx({ fulfilment: "pickup" }))).toBe("delivery_only");
    expect(promoRejection(free, ctx({ fulfilment: "delivery" }))).toBeNull();
  });
  test("when it is both used up and expired, the customer is told it has expired", () => {
    expect(promoRejection(promo({ maxRedemptions: 1, expiresAt: new Date("2026-01-01T00:00:00Z") }), ctx({ usage: { total: 1, mine: 0 } }))).toBe("expired");
  });
});

describe("applyPromo", () => {
  test("a percentage is taken off the items, rounded half up", () => {
    expect(applyPromo(promo({ value: 1000 }), 1_000_000, 0)).toEqual({ ok: true, itemDiscountMinor: 100_000, deliveryWaivedMinor: 0 });
    expect(applyPromo(promo({ value: 1250 }), 1_005, 0)).toMatchObject({ itemDiscountMinor: 126 }); // 125.625
  });
  test("a percentage can be capped", () => {
    expect(applyPromo(promo({ value: 5000, maxDiscountMinor: 200_000 }), 1_000_000, 0)).toMatchObject({ itemDiscountMinor: 200_000 });
    expect(applyPromo(promo({ value: 1000, maxDiscountMinor: 200_000 }), 1_000_000, 0)).toMatchObject({ itemDiscountMinor: 100_000 });
  });
  test("a fixed amount comes off the items but never more than the items cost", () => {
    expect(applyPromo(promo({ kind: "fixed", value: 300_000 }), 1_000_000, 0)).toMatchObject({ itemDiscountMinor: 300_000 });
    expect(applyPromo(promo({ kind: "fixed", value: 5_000_000 }), 1_000_000, 0)).toMatchObject({ itemDiscountMinor: 1_000_000 });
  });
  test("free delivery waives the fee and leaves the items alone", () => {
    expect(applyPromo(promo({ kind: "free_delivery", value: null }), 1_000_000, 150_000)).toEqual({ ok: true, itemDiscountMinor: 0, deliveryWaivedMinor: 150_000 });
  });
  test("the minimum order is measured on the items before the discount, and is inclusive", () => {
    expect(applyPromo(promo({ minOrderMinor: 1_000_000 }), 999_999, 0)).toEqual({ ok: false, reason: "below_minimum" });
    expect(applyPromo(promo({ minOrderMinor: 1_000_000 }), 1_000_000, 0)).toMatchObject({ ok: true });
  });
});

describe("promoText", () => {
  test("every reason has plain wording with no exclamation marks or dashes", () => {
    for (const r of ["unknown", "inactive", "not_started", "expired", "used_up", "already_used", "delivery_only", "below_minimum", "disabled", "free_order"] as const) {
      const t = promoText(r);
      expect(t.length, r).toBeGreaterThan(10);
      expect(t, r).not.toMatch(/[!]|—|--/);
    }
  });
});
