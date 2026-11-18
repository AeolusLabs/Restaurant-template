import { describe, expect, test } from "vitest";
import { parsePromoForm, promoToForm, type PromoFormValues } from "../src/domain/promos/form";

const env = { exponent: 2, timeZone: "Africa/Lagos" };
const form = (over: Partial<PromoFormValues> = {}): PromoFormValues => ({
  code: "welcome10",
  description: "",
  kind: "percent",
  percent: "10",
  amount: "",
  minOrder: "",
  maxDiscount: "",
  startsAt: "",
  expiresAt: "",
  maxRedemptions: "",
  maxPerCustomer: "1",
  active: "on",
  ...over,
});
const ok = (over: Partial<PromoFormValues> = {}) => {
  const r = parsePromoForm(form(over), env);
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.errors)}`);
  return r.fields;
};
const errors = (over: Partial<PromoFormValues>) => {
  const r = parsePromoForm(form(over), env);
  if (r.ok) throw new Error("expected errors");
  return r.errors;
};

describe("parsePromoForm: the kinds", () => {
  test("a percentage becomes basis points, and the code is upper-cased", () => {
    expect(ok()).toMatchObject({ code: "WELCOME10", kind: "percent", value: 1000, minOrderMinor: 0, maxDiscountMinor: null, active: true });
    expect(ok({ percent: "12.5" }).value).toBe(1250);
    expect(ok({ percent: "100" }).value).toBe(10_000);
    expect(ok({ percent: "0.01" }).value).toBe(1);
  });

  test("a fixed amount is read exactly in kobo, and the percentage box is ignored", () => {
    expect(ok({ kind: "fixed", amount: "500", percent: "garbage" })).toMatchObject({ kind: "fixed", value: 50_000 });
    expect(ok({ kind: "fixed", amount: "1,250.50" }).value).toBe(125_050);
  });

  test("free delivery has no value, and ignores the other boxes", () => {
    expect(ok({ kind: "free_delivery", percent: "x", amount: "y", maxDiscount: "z" })).toMatchObject({ kind: "free_delivery", value: null, maxDiscountMinor: null });
  });

  test("a cap only applies to a percentage", () => {
    expect(ok({ maxDiscount: "2000" }).maxDiscountMinor).toBe(200_000);
    expect(ok({ kind: "fixed", amount: "500", maxDiscount: "2000" }).maxDiscountMinor).toBeNull();
  });
});

describe("parsePromoForm: what is refused, with a message beside the right box", () => {
  test("a bad code", () => {
    for (const code of ["", "ab", "has space", "x".repeat(21), "semi;colon"]) expect(errors({ code }).code, code).toMatch(/3 to 20/);
  });
  test("a bad percentage", () => {
    for (const percent of ["", "0", "100.01", "-5", "abc", "10.555", "1e2"]) expect(errors({ percent }).percent, percent).toBeTruthy();
  });
  test("a bad fixed amount", () => {
    for (const amount of ["", "0", "-5", "abc", "10.555"]) expect(errors({ kind: "fixed", amount }).amount, amount).toBeTruthy();
  });
  test("a bad minimum order or cap", () => {
    expect(errors({ minOrder: "abc" }).minOrder).toBeTruthy();
    expect(errors({ maxDiscount: "0" }).maxDiscount).toBeTruthy();
    expect(errors({ maxDiscount: "abc" }).maxDiscount).toBeTruthy();
  });
  test("a limit that is not a whole number above zero", () => {
    for (const maxRedemptions of ["0", "-1", "1.5", "many"]) expect(errors({ maxRedemptions }).maxRedemptions, maxRedemptions).toBeTruthy();
    for (const maxPerCustomer of ["0", "-1", "1.5", "x"]) expect(errors({ maxPerCustomer }).maxPerCustomer, maxPerCustomer).toBeTruthy();
  });
  test("an unknown kind and a description that is too long", () => {
    expect(errors({ kind: "bogof" as never }).kind).toBeTruthy();
    expect(errors({ description: "d".repeat(201) }).description).toBeTruthy();
  });
  test("several problems are all reported at once", () => {
    expect(Object.keys(errors({ code: "x", percent: "0", maxRedemptions: "0" })).sort()).toEqual(["code", "maxRedemptions", "percent"]);
  });
});

describe("parsePromoForm: limits and dates", () => {
  test("blank limits mean unlimited", () => {
    expect(ok({ maxRedemptions: "", maxPerCustomer: "" })).toMatchObject({ maxRedemptions: null, maxPerCustomer: null });
    expect(ok({ maxRedemptions: "100", maxPerCustomer: "3" })).toMatchObject({ maxRedemptions: 100, maxPerCustomer: 3 });
  });

  test("dates are read as wall-clock time in the restaurant's timezone (Lagos is UTC+1, no daylight saving)", () => {
    const f = ok({ startsAt: "2026-12-01T09:00", expiresAt: "2026-12-31T23:30" });
    expect(f.startsAt?.toISOString()).toBe("2026-12-01T08:00:00.000Z");
    expect(f.expiresAt?.toISOString()).toBe("2026-12-31T22:30:00.000Z");
    expect(ok().startsAt).toBeNull();
  });

  test("the end must come after the start, and a date must be a date", () => {
    expect(errors({ startsAt: "2026-12-02T09:00", expiresAt: "2026-12-01T09:00" }).expiresAt).toMatch(/after/);
    expect(errors({ startsAt: "2026-12-01T09:00", expiresAt: "2026-12-01T09:00" }).expiresAt).toMatch(/after/);
    expect(errors({ startsAt: "tomorrow" }).startsAt).toBeTruthy();
    expect(errors({ expiresAt: "2026-02-30T10:00" }).expiresAt).toBeTruthy();
  });

  test("active is a checkbox: only 'on' means on", () => {
    expect(ok({ active: "on" }).active).toBe(true);
    expect(ok({ active: "" }).active).toBe(false);
  });
});

describe("promoToForm", () => {
  test("shows a saved promo the way it was typed, so an edit round-trips exactly", () => {
    const fields = ok({ kind: "percent", percent: "12.5", minOrder: "3500.50", maxDiscount: "2000", startsAt: "2026-12-01T09:00", expiresAt: "2026-12-31T23:30", maxRedemptions: "100", maxPerCustomer: "" , description: "Welcome" });
    const shown = promoToForm({ ...fields }, env);
    expect(shown).toMatchObject({ code: "WELCOME10", percent: "12.5", minOrder: "3500.50", maxDiscount: "2000.00", startsAt: "2026-12-01T09:00", expiresAt: "2026-12-31T23:30", maxRedemptions: "100", maxPerCustomer: "", active: "on" });
    expect(parsePromoForm(shown, env)).toEqual({ ok: true, fields });
  });

  test("a fixed amount and free delivery show their own boxes", () => {
    expect(promoToForm(ok({ kind: "fixed", amount: "500" }), env)).toMatchObject({ kind: "fixed", amount: "500.00", percent: "" });
    expect(promoToForm(ok({ kind: "free_delivery" }), env)).toMatchObject({ kind: "free_delivery", amount: "", percent: "" });
  });
});
