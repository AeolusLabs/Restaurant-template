import { describe, expect, test } from "vitest";
import { planDemand, stuckReason } from "../src/domain/agents/ops";

describe("planDemand", () => {
  const cells = [
    { date: "2026-10-30", hour: 12, orders: 6 },
    { date: "2026-10-30", hour: 19, orders: 10 },
    { date: "2026-11-06", hour: 12, orders: 8 },
    { date: "2026-11-06", hour: 19, orders: 14 },
  ];
  const items = [
    { name: "Jollof Rice", quantity: 20 },
    { name: "Zobo", quantity: 9 },
    { name: "Fried Rice", quantity: 20 },
    { name: "Pepper Soup", quantity: 4 },
    { name: "Water", quantity: 2 },
  ];

  test("expects the average of the same weekday in recent weeks, rounded up, with the busiest hour", () => {
    const plan = planDemand({ cells, items, dayCount: 2 });
    expect(plan).toMatchObject({ expectedOrders: 19, busiestHour: 19 }); // (6+10+8+14) / 2 = 19
  });

  test("names the top three dishes by how many are sold on such a day, ties by name", () => {
    const plan = planDemand({ cells, items, dayCount: 2 })!;
    expect(plan.topItems).toEqual([
      { name: "Fried Rice", perDay: 10 },
      { name: "Jollof Rice", perDay: 10 },
      { name: "Zobo", perDay: 5 },
    ]);
  });

  test("a dish sold at least once is never rounded down to none", () => {
    const plan = planDemand({ cells, items: [{ name: "Rare", quantity: 1 }], dayCount: 4 })!;
    expect(plan.topItems).toEqual([{ name: "Rare", perDay: 1 }]);
  });

  test("the earlier hour wins a tie for busiest", () => {
    const plan = planDemand({ cells: [{ date: "d1", hour: 20, orders: 5 }, { date: "d1", hour: 13, orders: 5 }], items: [], dayCount: 2 })!;
    expect(plan.busiestHour).toBe(13);
  });

  test("with fewer than two such days of history there is no plan, not a guess", () => {
    expect(planDemand({ cells, items, dayCount: 1 })).toBeNull();
    expect(planDemand({ cells, items, dayCount: 0 })).toBeNull();
  });

  test("days with no orders at all give no plan", () => {
    expect(planDemand({ cells: [], items: [], dayCount: 4 })).toBeNull();
  });
});

describe("stuckReason", () => {
  const t = { queuedMinutes: 20, awaitingMinutes: 60, transitMinutes: 120 };
  const d = (status: string, minutes: number, attempts = 0) => stuckReason({ status, attempts, minutes }, t);

  test("a booking that has failed and is still waiting too long", () => {
    expect(d("queued", 20, 2)).toMatch(/failed 2 times/);
    expect(d("queued", 19, 2)).toBeNull();
    expect(d("queued", 90, 1)).toMatch(/failed 1 time\b/);
  });
  test("a queued delivery that has not been tried yet is not stuck, only waiting its turn", () => {
    expect(d("queued", 500, 0)).toBeNull();
  });
  test("no rider assigned, or one who has not collected the order, after an hour", () => {
    expect(d("pending", 60)).toMatch(/No rider has been assigned/);
    expect(d("pending", 59)).toBeNull();
    expect(d("awaiting_pickup", 61)).toMatch(/not collected/);
  });
  test("on the road for too long", () => {
    expect(d("in_transit", 120)).toMatch(/on the road/);
    expect(d("in_transit", 119)).toBeNull();
  });
  test("a finished, cancelled, failed or unknown delivery is never stuck", () => {
    for (const s of ["delivered", "cancelled", "failed", "unknown", "something-new"]) expect(d(s, 10_000), s).toBeNull();
  });
  test("the wording gives the minutes", () => {
    expect(d("pending", 75)).toContain("75 minutes");
  });
});
