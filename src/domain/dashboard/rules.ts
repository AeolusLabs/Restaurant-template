import { WEEKDAYS, localDay, zonedToUtc } from "../time";

// Rules for the dashboard. Pure: no database, no HTTP. The database supplies counts and sums; this decides the
// period windows (in the restaurant's timezone, so "today" is the restaurant's today), the comparison and the
// verdicts. See docs/superpowers/plans/2026-11-18-phase-7-dashboard.md.

export type LocalDay = { y: number; m: number; d: number; key: string; weekday: (typeof WEEKDAYS)[number] };
export type Period = {
  days: number;
  /** Local midnight at the start of the first day. */
  start: Date;
  /** Now: today is counted so far. */
  end: Date;
  /** The same number of days straight before `start`. */
  prevStart: Date;
  prevEnd: Date;
  localDays: LocalDay[];
};

const two = (n: number) => String(n).padStart(2, "0");

/** The last `days` local days including today so far, and the same number of days before them. */
export function periodFor(now: Date, days: number, timeZone: string): Period {
  const day = (offset: number): LocalDay => {
    const d = localDay(now.getTime(), timeZone, offset);
    return { y: d.y, m: d.m, d: d.d, key: `${d.y}-${two(d.m)}-${two(d.d)}`, weekday: d.weekday };
  };
  const midnight = (d: LocalDay) => new Date(zonedToUtc(d.y, d.m, d.d, 0, 0, timeZone));
  const localDays = Array.from({ length: days }, (_, i) => day(-(days - 1) + i));
  const start = midnight(localDays[0]);
  return { days, start, end: now, prevStart: midnight(day(-(2 * days - 1))), prevEnd: start, localDays };
}

/** The change from `previous` to `current` as a whole percent, or null when there is nothing to compare with. */
export function changePercent(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export type HeatStep = 0 | 1 | 2 | 3 | 4;

/** Which of five shades a cell takes: 0 for none, then four equal steps up to the busiest cell. */
export function heatStep(count: number, max: number): HeatStep {
  if (count <= 0 || max <= 0) return 0;
  return Math.min(4, Math.ceil((count * 4) / max)) as HeatStep;
}

export type HeatCell = { /** 1 is Monday, 7 is Sunday. */ weekday: number; hour: number; orders: number };

/** The cell with the most orders; the earlier one in the week wins a tie. Null when nothing was ordered. */
export function busiestCell(cells: HeatCell[]): HeatCell | null {
  let best: HeatCell | null = null;
  for (const c of cells) {
    if (c.orders <= 0) continue;
    if (!best || c.orders > best.orders || (c.orders === best.orders && (c.weekday < best.weekday || (c.weekday === best.weekday && c.hour < best.hour)))) best = c;
  }
  return best;
}

export type DeliveryFigures = { deliveries: number; collectedMinor: number; costMinor: number };
export type DeliveryVerdict = { kind: "profit" | "loss" | "even" | "none"; netMinor: number; perDeliveryMinor: number };

/** What customers paid for delivery against what the riders cost. A loss is the thing to act on. */
export function deliveryVerdict(f: DeliveryFigures): DeliveryVerdict {
  if (f.deliveries <= 0) return { kind: "none", netMinor: 0, perDeliveryMinor: 0 };
  const netMinor = f.collectedMinor - f.costMinor;
  const half = Math.round(Math.abs(netMinor) / f.deliveries);
  const perDeliveryMinor = netMinor < 0 && half > 0 ? -half : half; // never -0
  return { kind: netMinor > 0 ? "profit" : netMinor < 0 ? "loss" : "even", netMinor, perDeliveryMinor };
}
