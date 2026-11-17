import { describe, expect, test } from "vitest";
import { ORDER_STATUSES } from "../src/domain/orders/statuses";
import { nextActions, canRefund } from "../src/domain/orders/actions";
import { canTransition } from "../src/domain/orders/transitions";

const tos = (role: "kitchen" | "manager" | "owner", status: Parameters<typeof nextActions>[1], fulfilment: "pickup" | "delivery" = "pickup") =>
  nextActions(role, status, fulfilment).map((a) => a.to);

describe("nextActions", () => {
  test("the kitchen moves an order forward and can never cancel", () => {
    expect(tos("kitchen", "paid")).toEqual(["accepted"]);
    expect(tos("kitchen", "accepted")).toEqual(["preparing"]);
    expect(tos("kitchen", "preparing")).toEqual(["ready"]);
    expect(tos("kitchen", "ready")).toEqual(["picked_up"]);
    for (const s of ORDER_STATUSES) expect(tos("kitchen", s), s).not.toContain("cancelled");
  });

  test("a manager or owner can also cancel before the food is ready, and complete a collected order", () => {
    for (const role of ["manager", "owner"] as const) {
      expect(tos(role, "paid")).toEqual(["accepted", "cancelled"]);
      expect(tos(role, "accepted")).toEqual(["preparing", "cancelled"]);
      expect(tos(role, "preparing")).toEqual(["ready"]);
      expect(tos(role, "picked_up")).toEqual(["completed"]);
    }
  });

  test("an unpaid order has no staff actions, and finished ones have none either", () => {
    for (const role of ["kitchen", "manager", "owner"] as const) {
      for (const s of ["placed", "completed", "cancelled", "refunded"] as const) expect(tos(role, s), `${role} ${s}`).toEqual([]);
    }
  });

  test("handing an order to a rider is the system's job, not a screen's", () => {
    expect(tos("manager", "ready", "delivery")).toEqual([]);
    expect(tos("manager", "ready", "pickup")).toEqual(["picked_up"]);
  });

  test("never offers anything the state machine would refuse", () => {
    for (const role of ["kitchen", "manager", "owner"] as const) {
      for (const status of ORDER_STATUSES) {
        for (const fulfilment of ["pickup", "delivery"] as const) {
          for (const a of nextActions(role, status, fulfilment)) {
            const actor = { type: "staff", id: "x", role } as const;
            expect(canTransition(status, a.to, fulfilment, actor), `${role} ${status}->${a.to} ${fulfilment}`).toBe(true);
          }
        }
      }
    }
  });

  test("cancelling is marked as needing confirmation and is listed last, so it is never the easy tap", () => {
    const actions = nextActions("manager", "paid", "pickup");
    expect(actions.at(-1)).toMatchObject({ to: "cancelled", needsConfirm: true });
    expect(actions[0]).toMatchObject({ to: "accepted", needsConfirm: false });
  });

  test("every action has a plain label", () => {
    for (const a of nextActions("manager", "paid", "pickup")) expect(a.label.length).toBeGreaterThan(2);
  });
});

describe("canRefund", () => {
  test("only managers and owners, and only for cancelled or completed orders", () => {
    expect(canRefund("manager", "cancelled")).toBe(true);
    expect(canRefund("owner", "completed")).toBe(true);
    expect(canRefund("kitchen", "cancelled")).toBe(false);
    for (const s of ORDER_STATUSES.filter((x) => x !== "cancelled" && x !== "completed")) expect(canRefund("manager", s), s).toBe(false);
  });
});
