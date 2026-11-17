import type { RestaurantConfig } from "../../config/schema";
import { localDay, toMinutes, zonedToUtc } from "./time";

// Words for opening hours and pickup times, in the restaurant's timezone and locale. Pure.

type HoursConfig = Pick<RestaurantConfig, "timezone" | "openingHours" | "locale">;

const clock = (at: number, cfg: HoursConfig) =>
  new Intl.DateTimeFormat(cfg.locale, { hour: "numeric", minute: "2-digit", timeZone: cfg.timezone }).format(at);
const weekday = (at: number, cfg: HoursConfig) => new Intl.DateTimeFormat(cfg.locale, { weekday: "short", timeZone: cfg.timezone }).format(at);

/** Whether the restaurant is open at `now`, and a short line saying when it closes or next opens. */
export function openStatus(now: Date, cfg: HoursConfig): { open: boolean; label: string } {
  const t = now.getTime();
  for (let offset = 0; offset <= 7; offset++) {
    const { y, m, d, weekday: key } = localDay(t, cfg.timezone, offset);
    const windows = [...cfg.openingHours[key]].sort((a, b) => toMinutes(a.open) - toMinutes(b.open));
    for (const w of windows) {
      const [oh, om] = [Math.floor(toMinutes(w.open) / 60), toMinutes(w.open) % 60];
      const [ch, cm] = [Math.floor(toMinutes(w.close) / 60), toMinutes(w.close) % 60];
      const opens = zonedToUtc(y, m, d, oh, om, cfg.timezone);
      const closes = zonedToUtc(y, m, d, ch, cm, cfg.timezone);
      if (t >= opens && t < closes) return { open: true, label: `Open until ${clock(closes, cfg)}` };
      if (opens > t) {
        return { open: false, label: offset === 0 ? `Closed. Opens at ${clock(opens, cfg)}` : `Closed. Opens ${weekday(opens, cfg)} ${clock(opens, cfg)}` };
      }
    }
  }
  return { open: false, label: "Closed" };
}

/** "Today, 6:15 pm", "Tomorrow, 10:00 am", or "Wed 18 Nov, 10:00 am". */
export function describeSlot(slot: Date, now: Date, cfg: HoursConfig): string {
  const a = localDay(now.getTime(), cfg.timezone);
  const b = localDay(slot.getTime(), cfg.timezone);
  const days = Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000);
  const time = clock(slot.getTime(), cfg);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Tomorrow, ${time}`;
  const date = new Intl.DateTimeFormat(cfg.locale, { day: "numeric", month: "short", timeZone: cfg.timezone }).format(slot);
  return `${weekday(slot.getTime(), cfg)} ${date}, ${time}`;
}
