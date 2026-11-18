import { describe, expect, test } from "vitest";
import { ORDER_STATUSES } from "../src/domain/orders/statuses";
import { DELIVERY_STEPS, PICKUP_STEPS, describeRider, describeStatus, staffDeliveryLabel, isFinished, isPayable, stepIndex } from "../src/domain/orders/presentation";

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

import { staffLabel } from "../src/domain/orders/presentation";
describe("staffLabel", () => {
  test("every status has a short label for staff screens", () => {
    for (const s of ORDER_STATUSES) expect(staffLabel(s).length, s).toBeGreaterThan(2);
    expect(staffLabel("paid")).toBe("New");
    expect(staffLabel("placed")).toBe("Unpaid");
    expect(staffLabel("picked_up")).toBe("Collected");
  });
});

describe("delivery orders", () => {
  test("the progress steps run from placed to delivered, through the rider", () => {
    expect(DELIVERY_STEPS.map((s) => s.status)).toEqual(["placed", "paid", "accepted", "preparing", "ready", "out_for_delivery", "completed"]);
    expect(DELIVERY_STEPS.at(-1)?.label).toMatch(/delivered/i);
  });

  test("each status sits on its own step, and a pickup order is unchanged", () => {
    expect(stepIndex("ready", "delivery")).toBe(4);
    expect(stepIndex("out_for_delivery", "delivery")).toBe(5);
    expect(stepIndex("completed", "delivery")).toBe(6);
    expect(stepIndex("completed")).toBe(5);
    expect(stepIndex("completed", "pickup")).toBe(5);
    expect(stepIndex("out_for_delivery")).toBeNull();
  });

  test("a failed, cancelled or refunded delivery has no progress to show", () => {
    for (const s of ["delivery_failed", "cancelled", "refunded"] as const) expect(stepIndex(s, "delivery"), s).toBeNull();
  });

  test("a ready delivery order talks about the rider, never the counter or showing a code", () => {
    const d = describeStatus("ready", "delivery");
    expect(d.detail).toMatch(/rider/i);
    expect(`${d.headline} ${d.detail}`).not.toMatch(/counter|pickup/i);
  });

  test("a completed delivery says delivered", () => {
    expect(describeStatus("completed", "delivery").headline).toMatch(/delivered/i);
    expect(describeStatus("completed").headline).toBe("Completed");
  });

  test("every status keeps the plain voice for delivery too", () => {
    for (const status of ORDER_STATUSES) {
      const d = describeStatus(status, "delivery");
      expect(d.headline.length, status).toBeGreaterThan(3);
      expect(`${d.headline} ${d.detail}`, status).not.toMatch(/[!]|—|--/);
    }
  });
});

describe("describeRider", () => {
  test("says in plain words where the rider is", () => {
    expect(describeRider("queued")).toMatch(/booking/i);
    expect(describeRider("pending")).toMatch(/booked/i);
    expect(describeRider("awaiting_pickup")).toMatch(/restaurant/i);
    expect(describeRider("in_transit")).toMatch(/on the way/i);
    expect(describeRider("delivered")).toMatch(/delivered/i);
  });

  test("says nothing when there is no delivery yet or it went wrong, so the order's own message speaks", () => {
    for (const s of [null, undefined, "cancelled", "failed", "unknown", "something-new"]) expect(describeRider(s), String(s)).toBeNull();
  });

  test("keeps the plain voice", () => {
    for (const s of ["queued", "pending", "awaiting_pickup", "in_transit", "delivered"]) expect(describeRider(s)).not.toMatch(/[!]|—|--/);
  });
});

describe("staffDeliveryLabel", () => {
  test("names every delivery status in words, and an unrecognised one honestly", () => {
    for (const s of ["queued", "pending", "awaiting_pickup", "in_transit", "delivered", "cancelled", "failed", "unknown"]) {
      expect(staffDeliveryLabel(s), s).not.toBe(s);
      expect(staffDeliveryLabel(s), s).not.toMatch(/[!]|—|--/);
    }
    expect(staffDeliveryLabel("something-new")).toMatch(/unclear/i);
  });
});
