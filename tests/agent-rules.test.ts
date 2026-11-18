import { describe, expect, test } from "vitest";
import { callEstimateMinor, costMinor, effectiveMode, estimateTokens, fallbackTemplate, fillTemplate, monthWindow, validateTemplate, withinCap } from "../src/domain/agents/rules";

const price = { inputPerMTokMinor: 300_000, outputPerMTokMinor: 1_500_000 }; // per million tokens, in kobo

describe("costMinor", () => {
  test("is tokens times the per-million price, in whole kobo", () => {
    expect(costMinor({ inputTokens: 1_000_000, outputTokens: 0 }, price)).toBe(300_000);
    expect(costMinor({ inputTokens: 0, outputTokens: 1_000_000 }, price)).toBe(1_500_000);
    expect(costMinor({ inputTokens: 2_000_000, outputTokens: 500_000 }, price)).toBe(600_000 + 750_000);
  });
  test("always rounds up, so spend is never under-counted", () => {
    expect(costMinor({ inputTokens: 1, outputTokens: 0 }, price)).toBe(1); // 0.3 kobo is counted as 1
    expect(costMinor({ inputTokens: 0, outputTokens: 1 }, price)).toBe(2); // 1.5 rounds up to 2
  });
  test("no tokens cost nothing", () => {
    expect(costMinor({ inputTokens: 0, outputTokens: 0 }, price)).toBe(0);
  });
  test("a huge count stays exact (no floating point drift)", () => {
    expect(costMinor({ inputTokens: 9_007_199_254, outputTokens: 0 }, { inputPerMTokMinor: 3, outputPerMTokMinor: 0 })).toBe(Math.ceil((9_007_199_254 * 3) / 1_000_000));
  });
  test("refuses a negative or fractional count", () => {
    expect(() => costMinor({ inputTokens: -1, outputTokens: 0 }, price)).toThrow(RangeError);
    expect(() => costMinor({ inputTokens: 1.5, outputTokens: 0 }, price)).toThrow(RangeError);
  });
});

describe("callEstimateMinor", () => {
  test("estimates the input from its length and assumes the whole output allowance will be used", () => {
    const e = callEstimateMinor({ system: "x".repeat(4000), messages: [{ role: "user", content: "y".repeat(4000) }], maxOutputTokens: 500 }, price);
    expect(estimateTokens("x".repeat(4000))).toBe(1000);
    expect(e).toBe(costMinor({ inputTokens: 2000, outputTokens: 500 }, price));
  });
});

describe("withinCap", () => {
  test("allows spending up to the cap and not a kobo past it", () => {
    expect(withinCap(900, 100, 1000)).toBe(true);
    expect(withinCap(900, 101, 1000)).toBe(false);
  });
  test("a cap of zero allows nothing, even a free-looking call", () => {
    expect(withinCap(0, 1, 0)).toBe(false);
    expect(withinCap(0, 0, 0)).toBe(true); // a call that would cost nothing is not spending
  });
});

describe("monthWindow", () => {
  test("is the restaurant's calendar month, from local midnight on the 1st", () => {
    const w = monthWindow(new Date("2026-11-18T12:00:00Z"), "Africa/Lagos");
    expect(w.start.toISOString()).toBe("2026-10-31T23:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-11-30T23:00:00.000Z");
  });
  test("a moment just after local midnight on the 1st belongs to the new month, though it is still last month in UTC", () => {
    const w = monthWindow(new Date("2026-11-30T23:30:00Z"), "Africa/Lagos"); // 00:30 on 1 December in Lagos
    expect(w.start.toISOString()).toBe("2026-11-30T23:00:00.000Z");
  });
  test("handles December into January", () => {
    const w = monthWindow(new Date("2026-12-15T12:00:00Z"), "Africa/Lagos");
    expect(w.end.toISOString()).toBe("2026-12-31T23:00:00.000Z");
  });
});

describe("effectiveMode", () => {
  test("suggest_only is always advice, whatever the proposal is", () => {
    expect(effectiveMode("suggest_only", true, true)).toBe("advice");
    expect(effectiveMode("suggest_only", false, false)).toBe("advice");
  });
  test("approve_first always waits for a person", () => {
    expect(effectiveMode("approve_first", true, true)).toBe("approve");
    expect(effectiveMode("approve_first", false, false)).toBe("approve");
  });
  test("auto runs at once, except for anything a customer will read unless an owner confirmed it", () => {
    expect(effectiveMode("auto", false, false)).toBe("auto");
    expect(effectiveMode("auto", true, true)).toBe("auto");
    expect(effectiveMode("auto", true, false)).toBe("approve");
  });
});

describe("message templates", () => {
  test("fillTemplate puts the customer's details in", () => {
    expect(fillTemplate("Hi {name}, fancy {dish}?", { name: "Ada", dish: "Jollof Rice" })).toBe("Hi Ada, fancy Jollof Rice?");
  });
  test("a placeholder with no value is replaced by a neutral word, never left in or shown as undefined", () => {
    expect(fillTemplate("Hi {name}, fancy {dish}?", { name: "Ada" })).toBe("Hi Ada, fancy something from the menu?");
    expect(fillTemplate("Hi {name}!", {})).toBe("Hi there!");
  });
  test("values are plain text: braces in a name cannot inject another placeholder", () => {
    expect(fillTemplate("Hi {name}", { name: "{dish}" })).toBe("Hi {dish}");
  });

  test("a good template passes", () => {
    expect(validateTemplate("Hi {name}, we have missed you! Come back for {dish} soon.", ["name", "dish"])).toEqual({ ok: true });
  });
  test("is refused when it is too short, too long, uses an unknown placeholder, or carries a link", () => {
    expect(validateTemplate("Hi {name}", ["name"])).toMatchObject({ ok: false });
    expect(validateTemplate(`Hi {name}, ${"x".repeat(400)}`, ["name"])).toMatchObject({ ok: false });
    expect(validateTemplate("Hi {name}, use {secret} for a treat today", ["name"])).toMatchObject({ ok: false });
    expect(validateTemplate("Hi {name}, order now at http://evil.example for a treat", ["name"])).toMatchObject({ ok: false });
    expect(validateTemplate("Hi {name}, order now at HTTPS://evil.example for a treat", ["name"])).toMatchObject({ ok: false });
    expect(validateTemplate("Hi {name}, order at evil.example/menu for a treat", ["name"])).toMatchObject({ ok: false });
  });
  test("a promo code is only mentioned when {code} is allowed", () => {
    expect(validateTemplate("Hi {name}, use {code} for a treat on your next order", ["name"])).toMatchObject({ ok: false });
    expect(validateTemplate("Hi {name}, use {code} for a treat on your next order", ["name", "code"])).toEqual({ ok: true });
  });

  test("the fixed fallback is itself a valid template, with and without a code", () => {
    expect(validateTemplate(fallbackTemplate(false), ["name", "dish"])).toEqual({ ok: true });
    expect(validateTemplate(fallbackTemplate(true), ["name", "dish", "code"])).toEqual({ ok: true });
    expect(fallbackTemplate(true)).toContain("{code}");
    expect(fallbackTemplate(false)).not.toContain("{code}");
  });
});
