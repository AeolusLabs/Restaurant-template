import { describe, expect, test } from "vitest";
import { alertText } from "../src/domain/alerts/text";

const KINDS = ["payment_mismatch", "payment_late", "payment_duplicate", "refund_failed", "delivery_failed", "wallet_low"];

describe("alertText", () => {
  test("every kind of alert is explained in words and says what to do, never shown as its code", () => {
    for (const kind of KINDS) {
      const t = alertText(kind);
      expect(t, kind).not.toBe(kind);
      expect(t.length, kind).toBeGreaterThan(40);
      expect(t, kind).not.toMatch(/[!]|—|--/);
    }
  });

  test("a failed delivery sends the manager to retry or cancel, and a low wallet says to top it up", () => {
    expect(alertText("delivery_failed")).toMatch(/retry/i);
    expect(alertText("delivery_failed")).toMatch(/cancel/i);
    expect(alertText("wallet_low")).toMatch(/top (it )?up/i);
  });

  test("a recorded reason is added to a failed delivery's text", () => {
    expect(alertText("delivery_failed", { reason: "Possible duplicate order" })).toContain("Possible duplicate order");
  });

  test("a reason that is not text is ignored, and other kinds do not use it", () => {
    expect(alertText("delivery_failed", { reason: { nested: 1 } })).toBe(alertText("delivery_failed"));
    expect(alertText("wallet_low", { reason: "x" })).toBe(alertText("wallet_low"));
  });
});
