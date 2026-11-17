import { z } from "zod";
import { contrastWithWhite, parseOklch } from "../src/lib/color";
import { formatIssues } from "../src/lib/format-issues";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM (24h)");

const window = z
  .object({ open: hhmm, close: hhmm })
  .refine((w) => w.close > w.open, { message: "close must be after open" });

const day = z.array(window).default([]);

const bps = z.number().int().min(0).max(10_000);

const isTimezone = (tz: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export const restaurantConfigSchema = z.object({
  name: z.string().min(1),
  logo: z.string().nullable(),
  colors: z.object({
    // Buttons and links use white text on the primary colour, so it must be dark enough to read (WCAG AA).
    primary: z.string().superRefine((v, ctx) => {
      const c = parseOklch(v);
      if (!c) ctx.addIssue({ code: "custom", message: "write the colour as oklch(L% C H), for example oklch(48% 0.14 40)" });
      else if (contrastWithWhite(c) < 4.5) ctx.addIssue({ code: "custom", message: "too light for white text: it needs a contrast of at least 4.5:1 with white, so lower the lightness" });
    }),
    accent: z.string().refine((v) => parseOklch(v) !== null, { message: "write the colour as oklch(L% C H), for example oklch(70% 0.15 150)" }),
  }),
  contact: z.object({ phone: z.string().optional(), email: z.string().optional() }),
  address: z.object({
    line1: z.string().min(1),
    area: z.string().optional(),
    city: z.string().min(1),
    country: z.string().min(1),
  }),
  currency: z.object({
    code: z.string().regex(/^[A-Z]{3}$/),
    exponent: z.number().int().min(0).max(4),
  }),
  timezone: z.string().refine(isTimezone, { message: "unknown IANA timezone" }),
  locale: z.string().min(2),
  openingHours: z.object({
    mon: day,
    tue: day,
    wed: day,
    thu: day,
    fri: day,
    sat: day,
    sun: day,
  }),
  pickup: z.object({
    slotMinutes: z.number().int().positive(),
    minLeadMinutes: z.number().int().min(0),
    lastOrderCutoffMinutes: z.number().int().min(0),
  }),
  delivery: z.object({
    dispatchOn: z.enum(["accepted", "preparing", "ready"]),
    zones: z.array(z.object({ name: z.string().min(1), feeMinor: z.number().int().min(0) })),
  }),
  charges: z.object({
    serviceChargeBps: bps,
    taxBps: bps,
    pricesIncludeCharges: z.boolean(),
  }),
  orders: z.object({
    unpaidExpiryMinutes: z.number().int().positive(),
    cancellationWindow: z.enum(["before_acceptance", "before_preparing"]),
  }),
  features: z.strictObject({
    promos: z.boolean(),
    pickup: z.boolean(),
    delivery: z.boolean(),
    ai_agents: z.boolean(),
    demo_mode: z.boolean(),
  }),
  legal: z.object({
    // Stored with every consent. Bump it when the terms or privacy policy change.
    policyVersion: z.string().min(1),
  }),
  agents: z.object({
    defaultMonthlyCapMinor: z.number().int().min(0),
    modelPrices: z.record(
      z.string(),
      z.object({
        inputPerMTokMinor: z.number().int().min(0),
        outputPerMTokMinor: z.number().int().min(0),
      }),
    ),
  }),
});

export type RestaurantConfig = z.infer<typeof restaurantConfigSchema>;

export class ConfigError extends Error {}

/** Validates the config and, when it is wrong, says which fields, so a bad edit is easy to fix. */
export function parseRestaurantConfig(raw: unknown): RestaurantConfig {
  const result = restaurantConfigSchema.safeParse(raw);
  if (result.success) return result.data;
  throw new ConfigError(`Invalid restaurant config in config/restaurant.ts:\n${formatIssues(result.error.issues)}`);
}
