import { describe, expect, test } from "vitest";
import { ORDER_STATUSES } from "../src/domain/orders/statuses";
import { PICKUP_STEPS, describeStatus, isFinished, isPayable, stepIndex } from "../src/domain/orders/presentation";

describe("describeStatus", () => {
  test("every status has a plain headline, a next-step line and a tone", () => {
    for (const status of ORDER_STATUSES) {
      const d = describeStatus(status);
      expect(d.headline.length, status).toBeGreaterThan(3);
      expect(d.detail.length, status).toBeGreaterThan(3);
      expect(["info", "ok", "warn", "bad"]).toContain(d.tone);
      expect(`${d.headline} ${d.detail}`, status).not.toMatch(/[!]|—|--/); // no exclamation marks or dashes in the voice
    }
  });

  test("tells the customer what to do when the order is ready", () => {
    expect(describeStatus("ready").headline).toMatch(/ready/i);
    expect(describeStatus("ready").detail).toMatch(/code/i);
  });

  test("an unpaid order says it is waiting for payment, not that anything is wrong", () => {
    expect(describeStatus("placed")).toMatchObject({ tone: "info" });
    expect(describeStatus("placed").headline).toMatch(/payment/i);
  });

  test("cancelled and refunded orders are not shown as good news", () => {
    expect(describeStatus("cancelled").tone).toBe("bad");
    expect(describeStatus("refunded").tone).toBe("warn");
  });
});

describe("stepIndex and isFinished", () => {
  test("the progress steps run from placed to collected", () => {
    expect(PICKUP_STEPS.map((s) => s.status)).toEqual(["placed", "paid", "accepted", "preparing", "ready", "picked_up"]);
  });

  test("each active status sits on its own step, and completed counts as collected", () => {
    expect(stepIndex("placed")).toBe(0);
    expect(stepIndex("paid")).toBe(1);
    expect(stepIndex("ready")).toBe(4);
    expect(stepIndex("picked_up")).toBe(5);
    expect(stepIndex("completed")).toBe(5);
  });

  test("a cancelled or refunded order has no progress to show", () => {
    expect(stepIndex("cancelled")).toBeNull();
    expect(stepIndex("refunded")).toBeNull();
  });

  test("polling stops once an order cannot change for the customer any more", () => {
    for (const s of ["completed", "cancelled", "refunded"] as const) expect(isFinished(s), s).toBe(true);
    for (const s of ["placed", "paid", "accepted", "preparing", "ready", "picked_up"] as const) expect(isFinished(s), s).toBe(false);
  });
});

describe("isPayable", () => {
  const now = new Date("2026-11-16T12:00:00Z");
  test("an unpaid order can be paid until its hold runs out", () => {
    expect(isPayable({ status: "placed", expiresAt: new Date("2026-11-16T12:30:00Z") }, now)).toBe(true);
    expect(isPayable({ status: "placed", expiresAt: new Date("2026-11-16T11:59:59Z") }, now)).toBe(false);
    expect(isPayable({ status: "placed", expiresAt: null }, now)).toBe(true);
  });
  test("a paid or cancelled order cannot be paid", () => {
    for (const status of ["paid", "cancelled", "completed"] as const) {
      expect(isPayable({ status, expiresAt: new Date("2026-11-16T12:30:00Z") }, now), status).toBe(false);
    }
  });
});
