import { describe, expect, test } from "vitest";
import { isValidPickupSlot, pickupSlots, PICKUP_DAYS_AHEAD, type PickupConfig } from "../src/domain/pickup/slots";

const day = (...windows: [string, string][]) => windows.map(([open, close]) => ({ open, close }));
const week = (d: ReturnType<typeof day>) => ({ mon: d, tue: d, wed: d, thu: d, fri: d, sat: d, sun: d });

const lagos: PickupConfig = {
  timezone: "Africa/Lagos", // UTC+1, no daylight saving
  openingHours: { ...week(day(["10:00", "21:00"])), sun: [] },
  pickup: { slotMinutes: 15, minLeadMinutes: 20, lastOrderCutoffMinutes: 30 },
};
// 2026-11-16 is a Monday.
const at = (iso: string) => new Date(iso);

describe("pickupSlots", () => {
  test("starts at the first grid slot after the lead time and ends at closing minus the cutoff", () => {
    const now = at("2026-11-16T11:07:00Z"); // Monday 12:07 in Lagos
    const slots = pickupSlots(now, lagos);
    expect(slots[0]).toEqual(at("2026-11-16T11:30:00Z")); // 12:30 local, the first slot at or after 12:27
    const monday = slots.filter((s) => s.getTime() < at("2026-11-16T23:00:00Z").getTime());
    expect(monday.at(-1)).toEqual(at("2026-11-16T19:30:00Z")); // 20:30 local, 21:00 close minus 30
  });

  test("slots ascend, sit on the grid and stay inside opening hours", () => {
    const slots = pickupSlots(at("2026-11-16T07:00:00Z"), lagos);
    expect(slots.length).toBeGreaterThan(10);
    for (let i = 1; i < slots.length; i++) expect(slots[i].getTime()).toBeGreaterThan(slots[i - 1].getTime());
    for (const s of slots) {
      const local = new Date(s.getTime() + 60 * 60_000); // Lagos is UTC+1
      expect(local.getUTCMinutes() % 15).toBe(0);
      const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
      expect(minutes).toBeGreaterThanOrEqual(10 * 60);
      expect(minutes).toBeLessThanOrEqual(20 * 60 + 30);
    }
  });

  test("a slot closer than the lead time is not offered", () => {
    const now = at("2026-11-16T11:00:00Z"); // 12:00 local, lead 20 minutes
    expect(pickupSlots(now, lagos)[0]).toEqual(at("2026-11-16T11:30:00Z")); // 12:15 is only 15 minutes away
  });

  test("a slot exactly at the lead time is offered", () => {
    const now = at("2026-11-16T11:10:00Z"); // 12:10 local, so 12:30 is exactly 20 minutes away
    expect(pickupSlots(now, lagos)[0]).toEqual(at("2026-11-16T11:30:00Z"));
  });

  test("a closed day has no slots, and the list moves on to the next open day", () => {
    const now = at("2026-11-21T22:00:00Z"); // Saturday 23:00 local, Sunday is closed
    const slots = pickupSlots(now, lagos);
    expect(slots[0]).toEqual(at("2026-11-23T09:00:00Z")); // Monday 10:00 local
    expect(slots.every((s) => s.getTime() >= at("2026-11-23T00:00:00Z").getTime())).toBe(true);
  });

  test("a break between two windows leaves a gap", () => {
    const cfg: PickupConfig = { ...lagos, openingHours: week(day(["10:00", "14:00"], ["17:00", "21:00"])) };
    const slots = pickupSlots(at("2026-11-16T07:00:00Z"), cfg); // Monday 08:00 local
    const local = slots.slice(0, 40).map((s) => new Date(s.getTime() + 3_600_000).toISOString().slice(11, 16));
    expect(local).toContain("13:30"); // 14:00 minus the cutoff
    expect(local).not.toContain("13:45");
    expect(local).not.toContain("16:45");
    expect(local).toContain("17:00");
  });

  test("the restaurant's local day decides what today is, not UTC", () => {
    const now = at("2026-11-16T23:30:00Z"); // already Tuesday 00:30 in Lagos
    expect(pickupSlots(now, lagos)[0]).toEqual(at("2026-11-17T09:00:00Z")); // Tuesday 10:00 local
  });

  test("covers today and the next days only", () => {
    const slots = pickupSlots(at("2026-11-16T07:00:00Z"), lagos);
    const last = slots.at(-1)!;
    expect(last.getTime()).toBeLessThan(at("2026-11-16T00:00:00Z").getTime() + (PICKUP_DAYS_AHEAD + 1) * 86_400_000);
  });

  test("follows daylight saving: the same wall-clock hour is a different instant after the clocks change", () => {
    const ny: PickupConfig = {
      timezone: "America/New_York",
      openingHours: week(day(["10:00", "12:00"])),
      pickup: { slotMinutes: 30, minLeadMinutes: 0, lastOrderCutoffMinutes: 0 },
    };
    // US clocks go back at 02:00 on Sunday 2026-11-01.
    const slots = pickupSlots(at("2026-10-31T12:00:00Z"), ny);
    expect(slots).toContainEqual(at("2026-10-31T14:00:00Z")); // Saturday 10:00 EDT (UTC-4)
    expect(slots).toContainEqual(at("2026-11-01T15:00:00Z")); // Sunday 10:00 EST (UTC-5)
  });

  test("no opening hours at all means no slots", () => {
    const closed: PickupConfig = { ...lagos, openingHours: week([]) };
    expect(pickupSlots(at("2026-11-16T07:00:00Z"), closed)).toEqual([]);
  });
});

describe("isValidPickupSlot", () => {
  const now = at("2026-11-16T11:07:00Z");

  test("accepts every generated slot", () => {
    for (const s of pickupSlots(now, lagos)) expect(isValidPickupSlot(s, now, lagos)).toBe(true);
  });

  test("rejects a time off the grid, in the past, inside the lead time, after closing, or too far ahead", () => {
    expect(isValidPickupSlot(at("2026-11-16T11:31:00Z"), now, lagos)).toBe(false); // off the 15 minute grid
    expect(isValidPickupSlot(at("2026-11-16T09:00:00Z"), now, lagos)).toBe(false); // already past
    expect(isValidPickupSlot(at("2026-11-16T11:15:00Z"), now, lagos)).toBe(false); // 8 minutes away
    expect(isValidPickupSlot(at("2026-11-16T20:00:00Z"), now, lagos)).toBe(false); // 21:00 local, after the cutoff
    expect(isValidPickupSlot(at("2026-11-21T09:00:00Z"), now, lagos)).toBe(false); // five days away
    expect(isValidPickupSlot(new Date("not a date"), now, lagos)).toBe(false);
  });
});
