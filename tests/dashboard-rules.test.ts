import { describe, expect, test } from "vitest";
import { busiestCell, changePercent, deliveryVerdict, heatStep, periodFor } from "../src/domain/dashboard/rules";
import { localParts } from "../src/domain/time";

const LAGOS = "Africa/Lagos"; // UTC+1 all year
const NOW = new Date("2026-11-18T12:00:00Z"); // Wednesday 13:00 in Lagos

describe("periodFor", () => {
  test("is the last N local days including today so far, from local midnight", () => {
    const p = periodFor(NOW, 7, LAGOS);
    expect(p.start.toISOString()).toBe("2026-11-11T23:00:00.000Z"); // midnight, Thursday 12 Nov in Lagos
    expect(p.end).toEqual(NOW);
    expect(p.localDays).toHaveLength(7);
    expect(p.localDays[0]).toMatchObject({ key: "2026-11-12", weekday: "thu" });
    expect(p.localDays[6]).toMatchObject({ key: "2026-11-18", weekday: "wed" });
  });

  test("the previous period is the same number of days straight before it, with no gap and no overlap", () => {
    const p = periodFor(NOW, 7, LAGOS);
    expect(p.prevEnd).toEqual(p.start);
    expect(p.prevStart.toISOString()).toBe("2026-11-04T23:00:00.000Z");
    const days = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 86_400_000;
    expect(days(p.prevStart, p.prevEnd)).toBe(7);
  });

  test("works for 30 and 90 days", () => {
    expect(periodFor(NOW, 30, LAGOS).localDays).toHaveLength(30);
    expect(periodFor(NOW, 90, LAGOS).localDays[0].key).toBe("2026-08-21");
  });

  test("a day just after local midnight is still today, even though it is yesterday in UTC", () => {
    const justAfterMidnight = new Date("2026-11-17T23:30:00Z"); // 00:30 on the 18th in Lagos
    const p = periodFor(justAfterMidnight, 7, LAGOS);
    expect(p.localDays.at(-1)?.key).toBe("2026-11-18");
  });

  test("starts at local midnight across a clock change (London, 25 Oct 2026)", () => {
    const p = periodFor(new Date("2026-10-27T12:00:00Z"), 30, "Europe/London");
    const at = localParts(p.start.getTime(), "Europe/London");
    expect([at.h, at.min]).toEqual([0, 0]);
    expect(p.localDays).toHaveLength(30);
    expect(p.localDays.at(-1)?.key).toBe("2026-10-27");
    const prev = localParts(p.prevStart.getTime(), "Europe/London");
    expect([prev.h, prev.min]).toEqual([0, 0]);
  });
});

describe("changePercent", () => {
  test("is the change against the earlier period, rounded to a whole percent", () => {
    expect(changePercent(150, 100)).toBe(50);
    expect(changePercent(50, 100)).toBe(-50);
    expect(changePercent(100, 100)).toBe(0);
    expect(changePercent(101, 100)).toBe(1);
    expect(changePercent(1, 3)).toBe(-67);
  });
  test("is null when there is nothing to compare with, never infinity or a made-up number", () => {
    expect(changePercent(0, 0)).toBeNull();
    expect(changePercent(500, 0)).toBeNull();
  });
  test("a fall to nothing is minus 100", () => {
    expect(changePercent(0, 400)).toBe(-100);
  });
});

describe("heatStep", () => {
  test("none is step 0; the busiest cell is step 4; everything else is in between", () => {
    expect(heatStep(0, 10)).toBe(0);
    expect(heatStep(10, 10)).toBe(4);
    expect(heatStep(1, 100)).toBe(1);
    expect(heatStep(25, 100)).toBe(1);
    expect(heatStep(26, 100)).toBe(2);
    expect(heatStep(50, 100)).toBe(2);
    expect(heatStep(75, 100)).toBe(3);
    expect(heatStep(76, 100)).toBe(4);
  });
  test("a grid with no orders at all has no steps", () => {
    expect(heatStep(0, 0)).toBe(0);
  });
});

describe("busiestCell", () => {
  const cells = [
    { weekday: 5, hour: 18, orders: 9 },
    { weekday: 2, hour: 12, orders: 4 },
    { weekday: 6, hour: 19, orders: 9 },
  ];
  test("is the cell with the most orders, and the earlier one in the week when two tie", () => {
    expect(busiestCell(cells)).toEqual({ weekday: 5, hour: 18, orders: 9 });
  });
  test("is null when there are no orders", () => {
    expect(busiestCell([])).toBeNull();
    expect(busiestCell([{ weekday: 1, hour: 9, orders: 0 }])).toBeNull();
  });
});

describe("deliveryVerdict", () => {
  test("customers paid more than the riders cost: a margin, with the figure per delivery", () => {
    expect(deliveryVerdict({ deliveries: 10, collectedMinor: 1_500_000, costMinor: 1_200_000 })).toEqual({ kind: "profit", netMinor: 300_000, perDeliveryMinor: 30_000 });
  });
  test("customers paid less than the riders cost: a loss, which is the thing to act on", () => {
    expect(deliveryVerdict({ deliveries: 4, collectedMinor: 400_000, costMinor: 600_000 })).toEqual({ kind: "loss", netMinor: -200_000, perDeliveryMinor: -50_000 });
  });
  test("exactly even", () => {
    expect(deliveryVerdict({ deliveries: 2, collectedMinor: 300_000, costMinor: 300_000 })).toMatchObject({ kind: "even", netMinor: 0 });
  });
  test("no deliveries means nothing to judge", () => {
    expect(deliveryVerdict({ deliveries: 0, collectedMinor: 0, costMinor: 0 })).toEqual({ kind: "none", netMinor: 0, perDeliveryMinor: 0 });
  });
  test("the per-delivery figure is rounded to a whole kobo, half away from zero", () => {
    expect(deliveryVerdict({ deliveries: 3, collectedMinor: 100_000, costMinor: 99_998 }).perDeliveryMinor).toBe(1); // 2 / 3 = 0.67
    expect(deliveryVerdict({ deliveries: 3, collectedMinor: 99_998, costMinor: 100_000 }).perDeliveryMinor).toBe(-1);
  });
});
