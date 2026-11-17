import type { RestaurantConfig } from "../../../config/schema";
import { localDay, toMinutes, zonedToUtc } from "../time";

// Pickup time slots from the opening hours in config. Pure: the caller passes `now`. Rulings 2 in
// docs/superpowers/plans/2026-11-17-phase-2-customer-side.md: slots start at each window's opening time on
// a grid of `slotMinutes`, the first is at least `minLeadMinutes` away, the last is `lastOrderCutoffMinutes`
// before closing, and the list covers today plus the next PICKUP_DAYS_AHEAD days in the restaurant's timezone.

export type PickupConfig = Pick<RestaurantConfig, "timezone" | "openingHours" | "pickup">;

export const PICKUP_DAYS_AHEAD = 2;

/** Every pickup time the restaurant can offer from `now`, ascending. */
export function pickupSlots(now: Date, cfg: PickupConfig): Date[] {
  const { slotMinutes, minLeadMinutes, lastOrderCutoffMinutes } = cfg.pickup;
  const earliest = now.getTime() + minLeadMinutes * 60_000;
  const slots: Date[] = [];

  for (let offset = 0; offset <= PICKUP_DAYS_AHEAD; offset++) {
    const { y, m, d, weekday } = localDay(now.getTime(), cfg.timezone, offset);
    for (const window of cfg.openingHours[weekday]) {
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
