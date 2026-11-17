import { describe, expect, test } from "vitest";
import { describeSlot, openStatus } from "../src/domain/hours";
import type { PickupConfig } from "../src/domain/pickup/slots";

const day = (...windows: [string, string][]) => windows.map(([open, close]) => ({ open, close }));
const cfg: PickupConfig & { locale: string } = {
  timezone: "Africa/Lagos", // UTC+1
  locale: "en-AU", // writes 2:00 pm and 18 Nov
  openingHours: {
    mon: day(["10:00", "14:00"], ["17:00", "21:00"]),
    tue: day(["10:00", "21:00"]),
    wed: day(["10:00", "21:00"]),
    thu: day(["10:00", "21:00"]),
    fri: day(["10:00", "22:00"]),
    sat: day(["11:00", "22:00"]),
    sun: [],
  },
  pickup: { slotMinutes: 15, minLeadMinutes: 20, lastOrderCutoffMinutes: 30 },
};
const at = (iso: string) => new Date(iso);
// 2026-11-16 is a Monday.

describe("openStatus", () => {
  test("open inside a window, and says when it closes", () => {
    const s = openStatus(at("2026-11-16T11:00:00Z"), cfg); // Monday 12:00 local
    expect(s.open).toBe(true);
    expect(s.label).toMatch(/^Open until 2:00\s?pm$/i);
  });

  test("closed between two windows, and says when it opens again today", () => {
    const s = openStatus(at("2026-11-16T14:00:00Z"), cfg); // Monday 15:00 local
    expect(s.open).toBe(false);
    expect(s.label).toMatch(/^Closed\. Opens at 5:00\s?pm$/i);
  });

  test("closed before opening and after closing", () => {
    expect(openStatus(at("2026-11-16T07:00:00Z"), cfg).label).toMatch(/^Closed\. Opens at 10:00\s?am$/i); // 08:00 local
    expect(openStatus(at("2026-11-16T21:00:00Z"), cfg).label).toMatch(/^Closed\. Opens Tue 10:00\s?am$/i); // 22:00 local
  });

  test("looks past a closed day for the next opening", () => {
    const s = openStatus(at("2026-11-22T12:00:00Z"), cfg); // Sunday, closed all day
    expect(s.open).toBe(false);
    expect(s.label).toMatch(/^Closed\. Opens Mon 10:00\s?am$/i);
  });

  test("clock style follows the configured locale (en-NG is a 24 hour clock)", () => {
    expect(openStatus(at("2026-11-16T11:00:00Z"), { ...cfg, locale: "en-NG" }).label).toBe("Open until 14:00");
  });

  test("a restaurant with no hours at all is reported closed", () => {
    const none = { ...cfg, openingHours: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] } };
    expect(openStatus(at("2026-11-16T11:00:00Z"), none)).toEqual({ open: false, label: "Closed" });
  });

  test("uses the restaurant's timezone, not the server's", () => {
    // 23:30 UTC Monday is already Tuesday 00:30 in Lagos.
    expect(openStatus(at("2026-11-16T23:30:00Z"), cfg).label).toMatch(/Opens at 10:00\s?am$/i);
  });
});

describe("describeSlot", () => {
  const now = at("2026-11-16T11:00:00Z"); // Monday 12:00 local

  test("today and tomorrow are named, later days show the date", () => {
    expect(describeSlot(at("2026-11-16T17:15:00Z"), now, cfg)).toMatch(/^Today, 6:15\s?pm$/i);
    expect(describeSlot(at("2026-11-17T09:00:00Z"), now, cfg)).toMatch(/^Tomorrow, 10:00\s?am$/i);
    expect(describeSlot(at("2026-11-18T09:00:00Z"), now, cfg)).toMatch(/^Wed,? 18 Nov,? 10:00\s?am$/i);
  });

  test("the day is the restaurant's local day", () => {
    // 23:30 UTC on Monday is Tuesday 00:30 locally, so it is already "Tomorrow".
    expect(describeSlot(at("2026-11-16T23:30:00Z"), now, cfg)).toMatch(/^Tomorrow, 12:30\s?am$/i);
  });
});
