import { z } from "zod";
import { MAX_LINE_QUANTITY } from "../pricing/price-cart";

// What the browser may send about a cart: which items, which modifiers, how many. Zod drops every other
// key, so a `price` or `total` smuggled into the request never reaches the pricing code.

export { lineKey } from "./line-key";

export const MAX_CART_LINES = 50;

export const cartLineSchema = z.object({
  itemId: z.uuid(),
  quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
  modifierIds: z.array(z.uuid()).max(30).default([]),
});

export const cartSchema = z.array(cartLineSchema).min(1).max(MAX_CART_LINES);

export type CartInput = z.infer<typeof cartSchema>;
