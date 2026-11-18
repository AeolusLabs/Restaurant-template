import { describe, expect, test } from "vitest";
import { parseAgentForm } from "../src/agents/settings-form";

const env = { exponent: 2 };

describe("the common settings", () => {
  test("enabled is a checkbox, autonomy must be one of the three, and a blank cap means the restaurant default", () => {
    expect(parseAgentForm("whatsapp-support", { enabled: "on", autonomy: "approve_first", cap: "", extraNotes: "" }, env)).toEqual({
      ok: true,
      value: { enabled: true, autonomy: "approve_first", monthlyCapMinor: null, settings: { extraNotes: "" } },
    });
    expect(parseAgentForm("whatsapp-support", { enabled: "", autonomy: "suggest_only", cap: "", extraNotes: "" }, env)).toMatchObject({ ok: true, value: { enabled: false } });
  });
  test("a cap is read exactly in kobo, zero is allowed (nothing can be spent), and anything else is refused", () => {
    expect(parseAgentForm("whatsapp-support", { autonomy: "suggest_only", cap: "500", extraNotes: "" }, env)).toMatchObject({ value: { monthlyCapMinor: 50_000 } });
    expect(parseAgentForm("whatsapp-support", { autonomy: "suggest_only", cap: "0", extraNotes: "" }, env)).toMatchObject({ value: { monthlyCapMinor: 0 } });
    for (const cap of ["-5", "abc", "10.555"]) expect(parseAgentForm("whatsapp-support", { autonomy: "suggest_only", cap, extraNotes: "" }, env), cap).toMatchObject({ ok: false, errors: { cap: expect.any(String) } });
  });
  test("an unknown autonomy level is refused", () => {
    expect(parseAgentForm("whatsapp-support", { autonomy: "wild", cap: "", extraNotes: "" }, env)).toMatchObject({ ok: false, errors: { autonomy: expect.any(String) } });
  });
  test("an unknown agent is refused", () => {
    expect(() => parseAgentForm("nobody", { autonomy: "suggest_only" }, env)).toThrow();
  });
});

describe("the win-back settings", () => {
  const form = (over: Record<string, string> = {}) => ({ enabled: "on", autonomy: "approve_first", cap: "", lapsedDays: "45", cooldownDays: "90", maxPerRun: "20", promoCode: "", ...over });
  test("numbers are read as whole numbers, and a blank promo code is none", () => {
    expect(parseAgentForm("winback", form(), env)).toMatchObject({ ok: true, value: { settings: { lapsedDays: 45, cooldownDays: 90, maxPerRun: 20, promoCode: null } } });
  });
  test("a promo code is tidied to upper case", () => {
    expect(parseAgentForm("winback", form({ promoCode: " comeback " }), env)).toMatchObject({ value: { settings: { promoCode: "COMEBACK" } } });
  });
  test("each setting is kept inside its range, with a message beside the right box", () => {
    expect(parseAgentForm("winback", form({ lapsedDays: "3" }), env)).toMatchObject({ ok: false, errors: { lapsedDays: expect.any(String) } });
    expect(parseAgentForm("winback", form({ cooldownDays: "7" }), env)).toMatchObject({ ok: false, errors: { cooldownDays: expect.any(String) } });
    expect(parseAgentForm("winback", form({ maxPerRun: "500" }), env)).toMatchObject({ ok: false, errors: { maxPerRun: expect.any(String) } });
    expect(parseAgentForm("winback", form({ lapsedDays: "abc" }), env)).toMatchObject({ ok: false, errors: { lapsedDays: expect.any(String) } });
    expect(parseAgentForm("winback", form({ lapsedDays: "45.5" }), env)).toMatchObject({ ok: false });
  });
  test("a promo code that cannot be a code is refused", () => {
    expect(parseAgentForm("winback", form({ promoCode: "bad code!" }), env)).toMatchObject({ ok: false, errors: { promoCode: expect.any(String) } });
  });
  test("several problems are all reported", () => {
    const r = parseAgentForm("winback", form({ lapsedDays: "1", maxPerRun: "0", cap: "x" }), env);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["cap", "lapsedDays", "maxPerRun"]);
  });
});

describe("the support settings", () => {
  test("the notes are kept, trimmed, and limited to 500 characters", () => {
    expect(parseAgentForm("whatsapp-support", { autonomy: "suggest_only", cap: "", extraNotes: "  Closed on public holidays.  " }, env)).toMatchObject({ value: { settings: { extraNotes: "Closed on public holidays." } } });
    expect(parseAgentForm("whatsapp-support", { autonomy: "suggest_only", cap: "", extraNotes: "x".repeat(501) }, env)).toMatchObject({ ok: false, errors: { extraNotes: expect.any(String) } });
  });
});
