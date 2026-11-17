import type { RestaurantConfig } from "../../../config/schema";

// Pickup time slots from the opening hours in config. Pure: the caller passes `now`. Rulings 2 in
// docs/superpowers/plans/2026-11-17-phase-2-customer-side.md: slots start at each window's opening time on
// a grid of `slotMinutes`, the first is at least `minLeadMinutes` away, the last is `lastOrderCutoffMinutes`
// before closing, and the list covers today plus the next PICKUP_DAYS_AHEAD days in the restaurant's timezone.

export type PickupConfig = Pick<RestaurantConfig, "timezone" | "openingHours" | "pickup">;

export const PICKUP_DAYS_AHEAD = 2;

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

type LocalParts = { y: number; m: number; d: number; h: number; min: number; s: number };

function localParts(utcMs: number, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), min: get("minute"), s: get("second") };
}

/** Minutes the timezone is ahead of UTC at this instant. */
function offsetMinutes(utcMs: number, timeZone: string): number {
  const p = localParts(utcMs, timeZone);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
  return (asUtc - Math.floor(utcMs / 1000) * 1000) / 60_000;
}

/** The instant at which the wall clock in `timeZone` reads y-m-d h:min. */
function zonedToUtc(y: number, m: number, d: number, h: number, min: number, timeZone: string): number {
  const guess = Date.UTC(y, m - 1, d, h, min);
  const first = guess - offsetMinutes(guess, timeZone) * 60_000;
  // The offset can differ at the corrected instant when a clock change falls in between.
  return guess - offsetMinutes(first, timeZone) * 60_000;
}

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** Every pickup time the restaurant can offer from `now`, ascending. */
export function pickupSlots(now: Date, cfg: PickupConfig): Date[] {
  const { slotMinutes, minLeadMinutes, lastOrderCutoffMinutes } = cfg.pickup;
  const earliest = now.getTime() + minLeadMinutes * 60_000;
  const today = localParts(now.getTime(), cfg.timezone);
  const slots: Date[] = [];

  for (let offset = 0; offset <= PICKUP_DAYS_AHEAD; offset++) {
    const date = new Date(Date.UTC(today.y, today.m - 1, today.d + offset));
    const [y, m, d] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
    for (const window of cfg.openingHours[WEEKDAYS[date.getUTCDay()]]) {
      const last = toMinutes(window.close) - lastOrderCutoffMinutes;
      for (let t = toMinutes(window.open); t <= last; t += slotMinutes) {
        const instant = zonedToUtc(y, m, d, Math.floor(t / 60), t % 60, cfg.timezone);
        if (instant >= earliest) slots.push(new Date(instant));
      }
    }
  }
  return slots.sort((a, b) => a.getTime() - b.getTime());
}

/** The server's check on a time the browser chose. The browser's list is only a convenience. */
export function isValidPickupSlot(at: Date, now: Date, cfg: PickupConfig): boolean {
  const t = at.getTime();
  return !Number.isNaN(t) && pickupSlots(now, cfg).some((s) => s.getTime() === t);
}
