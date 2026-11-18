import { z } from "zod";
import { cartSchema } from "./cart";

// The checkout form as the server accepts it. Anything not listed here (a price, a total, a status) is
// dropped by Zod before pricing starts.

const PHONE_CHARS = /^\+?[0-9 ()-]+$/;

export const phoneSchema = z
  .string()
  .trim()
  .refine((v) => PHONE_CHARS.test(v) && v.replace(/\D/g, "").length >= 7 && v.replace(/\D/g, "").length <= 15, {
    message: "Enter a phone number with 7 to 15 digits",
  });

export const createOrderSchema = z.object({
  lines: cartSchema,
  pickupAt: z.union([z.date(), z.iso.datetime({ offset: true }).transform((s) => new Date(s))]),
  phone: phoneSchema,
  notes: z
    .string()
    .trim()
    .max(200, "Keep notes to 200 characters")
    .optional()
    .transform((v) => v || undefined),
  /** The total the customer was shown. If the real total differs now, the order is refused, not placed. */
  expectedTotalMinor: z.number().int().nonnegative().optional(),
  /** One per checkout screen load. A second submit with the same token returns the same order. */
  checkoutToken: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
});

export type CreateOrderInput = z.input<typeof createOrderSchema>;
export type ParsedOrderInput = z.output<typeof createOrderSchema>;

/** The delivery checkout form. The fee is not here: the server takes it from the zone the customer picked. */
export const deliveryOrderSchema = z.object({
  lines: cartSchema,
  zone: z.string().trim().min(1, "Choose your area").max(100),
  address: z.string().trim().min(5, "Enter your full delivery address").max(200, "Keep the address to 200 characters"),
  landmark: z
    .string()
    .trim()
    .max(100, "Keep the landmark to 100 characters")
    .optional()
    .transform((v) => v || undefined),
  phone: phoneSchema,
  notes: z
    .string()
    .trim()
    .max(200, "Keep notes to 200 characters")
    .optional()
    .transform((v) => v || undefined),
  expectedTotalMinor: z.number().int().nonnegative().optional(),
  checkoutToken: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
});

export type CreateDeliveryOrderInput = z.input<typeof deliveryOrderSchema>;
