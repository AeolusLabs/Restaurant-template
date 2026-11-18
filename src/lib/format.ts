import { restaurantConfig } from "../../config/restaurant";
import { formatMoney, type MoneyFormat } from "./money";

/** The money format for this restaurant, from config. Safe to pass to client components as a prop. */
export const moneyFormat: MoneyFormat = {
  currency: restaurantConfig.currency.code,
  exponent: restaurantConfig.currency.exponent,
  locale: restaurantConfig.locale,
};

/** A price in the minor unit, written for this restaurant's currency and locale. Server components only. */
export const money = (amountMinor: number): string => formatMoney(amountMinor, moneyFormat);

/** A short amount for a chart axis (₦12.5K). For display only: it is never used in arithmetic. */
export const moneyCompact = (amountMinor: number): string =>
  new Intl.NumberFormat(moneyFormat.locale, { style: "currency", currency: moneyFormat.currency, notation: "compact", maximumFractionDigits: 1 }).format(amountMinor / 10 ** moneyFormat.exponent);

/** A moment written in the restaurant's timezone and locale, for example "Mon 16 Nov, 6:15 pm". */
export function dateTime(at: Date | string): string {
  return new Intl.DateTimeFormat(restaurantConfig.locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: restaurantConfig.timezone,
  }).format(new Date(at));
}
