import type { ProblemCode } from "@/domain/pricing/price-cart";
import { promoText } from "@/domain/promos/rules";

/** What to tell the customer when a line in their cart can no longer be ordered. */
export function problemText(code: ProblemCode): string {
  switch (code) {
    case "not_found":
    case "inactive":
      return "No longer on the menu. Remove it to continue.";
    case "sold_out":
      return "Sold out for now. Remove it to continue.";
    case "modifier_unavailable":
      return "One of your choices is unavailable. Remove this item and add it again.";
    case "modifier_invalid":
    case "selection_count":
      return "Your choices for this item need updating. Remove it and add it again.";
    case "quantity":
      return "This quantity cannot be ordered. Change it to continue.";
    case "empty_cart":
      return "Your cart is empty.";
    case "promo_below_minimum":
      return promoText("below_minimum");
    case "promo_free_order":
      return promoText("free_order");
  }
}
