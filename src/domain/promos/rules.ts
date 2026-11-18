import { applyBps } from "../../lib/money";

// Promo rules. Pure: no database, no HTTP. The database supplies the promo and how often it has been used;
// this decides whether it applies and by how much. See docs/superpowers/plans/2026-11-18-phase-5-promos-customers.md.

export type PromoKind = "percent" | "fixed" | "free_delivery";

/** What the price calculation needs. `value` is basis points for a percentage, kobo for a fixed amount, null for free delivery. */
export type PromoTerms = { kind: PromoKind; value: number | null; minOrderMinor: number; maxDiscountMinor: number | null };

export type Promo = PromoTerms & {
  code: string;
  active: boolean;
  startsAt: Date | null;
  expiresAt: Date | null;
  /** Total uses allowed across all customers. Null is unlimited. */
  maxRedemptions: number | null;
  /** Uses allowed per customer. Null is unlimited. */
  maxPerCustomer: number | null;
};

const CODE = /^[A-Z0-9_-]{3,20}$/;

/** The code as stored and matched: trimmed and upper case. Null when it could not be a code. */
export function normalizeCode(raw: string): string | null {
  const code = raw.trim().toUpperCase();
  return CODE.test(code) ? code : null;
}

export type PromoRejection = "inactive" | "not_started" | "expired" | "used_up" | "already_used" | "delivery_only";
export type PromoUsage = { total: number; mine: number };

/** Why this promo cannot be used right now by this customer, or null when it can. */
export function promoRejection(promo: Promo, ctx: { now: Date; usage: PromoUsage; fulfilment: "pickup" | "delivery" }): PromoRejection | null {
  if (!promo.active) return "inactive";
  if (promo.startsAt && ctx.now < promo.startsAt) return "not_started";
  if (promo.expiresAt && ctx.now >= promo.expiresAt) return "expired";
  if (promo.kind === "free_delivery" && ctx.fulfilment !== "delivery") return "delivery_only";
  if (promo.maxRedemptions !== null && ctx.usage.total >= promo.maxRedemptions) return "used_up";
  if (promo.maxPerCustomer !== null && ctx.usage.mine >= promo.maxPerCustomer) return "already_used";
  return null;
}

export type PromoApplication = { ok: true; itemDiscountMinor: number; deliveryWaivedMinor: number } | { ok: false; reason: "below_minimum" };

/**
 * How much the promo takes off. A percentage or fixed amount comes off the items (never more than they cost);
 * free delivery waives the fee. The minimum order is measured on the items before any discount.
 */
export function applyPromo(terms: PromoTerms, subtotalMinor: number, deliveryFeeMinor: number): PromoApplication {
  if (subtotalMinor < terms.minOrderMinor) return { ok: false, reason: "below_minimum" };
  if (terms.kind === "free_delivery") return { ok: true, itemDiscountMinor: 0, deliveryWaivedMinor: deliveryFeeMinor };
  const raw = terms.kind === "percent" ? applyBps(subtotalMinor, terms.value ?? 0) : (terms.value ?? 0);
  const capped = terms.maxDiscountMinor === null ? raw : Math.min(raw, terms.maxDiscountMinor);
  return { ok: true, itemDiscountMinor: Math.min(capped, subtotalMinor), deliveryWaivedMinor: 0 };
}

export type PromoProblem = PromoRejection | "unknown" | "below_minimum" | "disabled" | "free_order" | "signed_out";

/** What to tell the customer when a code cannot be used. `min` is the formatted minimum order, when there is one. */
export function promoText(reason: PromoProblem, extra: { min?: string } = {}): string {
  switch (reason) {
    case "unknown":
      return "We do not recognise that code. Check it and try again.";
    case "signed_out":
      return "Sign in to use a promo code.";
    case "disabled":
      return "Promo codes are not available right now.";
    case "inactive":
      return "That code is not active.";
    case "not_started":
      return "That code is not valid yet.";
    case "expired":
      return "That code has expired.";
    case "used_up":
      return "That code has been used up.";
    case "already_used":
      return "You have already used that code.";
    case "delivery_only":
      return "That code is for delivery orders only.";
    case "below_minimum":
      return extra.min ? `Spend at least ${extra.min} on items to use that code.` : "Your order is below the minimum for that code.";
    case "free_order":
      return "That code would cover the whole order, so it cannot be used here. Add something to your cart or try another code.";
  }
}
