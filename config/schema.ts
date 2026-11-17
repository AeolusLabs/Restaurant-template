import { z } from "zod";

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
  colors: z.object({ primary: z.string().min(1), accent: z.string().min(1) }),
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
