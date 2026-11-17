// Wall-clock time in the restaurant's timezone. Pure: built on Intl, no date library.

export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export type LocalParts = { y: number; m: number; d: number; h: number; min: number; s: number };

export function localParts(utcMs: number, timeZone: string): LocalParts {
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

/** The instant at which the wall clock in `timeZone` reads y-m-d h:min (m is 1 to 12). */
export function zonedToUtc(y: number, m: number, d: number, h: number, min: number, timeZone: string): number {
  const guess = Date.UTC(y, m - 1, d, h, min);
  const first = guess - offsetMinutes(guess, timeZone) * 60_000;
  // The offset can differ at the corrected instant when a clock change falls in between.
  return guess - offsetMinutes(first, timeZone) * 60_000;
}

/** "14:30" to minutes after midnight. */
export const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** The calendar day `offset` days after the local day of `utcMs`, as year, month (1 to 12), day and weekday key. */
export function localDay(utcMs: number, timeZone: string, offset = 0) {
  const t = localParts(utcMs, timeZone);
  const date = new Date(Date.UTC(t.y, t.m - 1, t.d + offset));
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate(), weekday: WEEKDAYS[date.getUTCDay()] };
}
