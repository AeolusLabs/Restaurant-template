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
  /** One per checkout screen load. A second submit with the same token returns the same order. */
  checkoutToken: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
});

export type CreateOrderInput = z.input<typeof createOrderSchema>;
export type ParsedOrderInput = z.output<typeof createOrderSchema>;
