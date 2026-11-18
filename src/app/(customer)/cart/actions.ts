"use server";

import { restaurantConfig } from "../../../../config/restaurant";
import { getIdentity } from "@/auth/customer";
import { withPublicContext } from "@/db/context";
import { loadPricingItems } from "@/db/menu";
import { previewPromo } from "@/db/promos";
import { cartSchema } from "@/domain/checkout/cart";
import { lineKey } from "@/domain/checkout/line-key";
import { priceCart, type ProblemCode } from "@/domain/pricing/price-cart";
import { promoText } from "@/domain/promos/rules";
import { money } from "@/lib/format";

export type QuoteLine = {
  key: string;
  itemId: string;
  quantity: number;
  /** Null when the item no longer exists. */
  name: string | null;
  modifiers: { name: string; priceDeltaMinor: number }[];
  unitPriceMinor?: number;
  lineTotalMinor?: number;
  problem?: ProblemCode;
};

export type Quote =
  | {
      ok: true;
      lines: QuoteLine[];
      subtotalMinor: number;
      serviceChargeMinor: number;
      taxMinor: number;
      /** Zero unless a delivery zone was given. Added after tax, never taxed. */
      deliveryFeeMinor: number;
      /** The zone the fee was worked out for, so the form can tell a stale answer from a current one. */
      deliveryZone: string | null;
      /** What a percentage or fixed promo took off the items. */
      discountMinor: number;
      /** What a free-delivery promo waived. */
      deliveryWaivedMinor: number;
      /** The code that was applied, if one was typed and could be used. */
      promo: { code: string; kind: string } | null;
      /** Why the typed code was not applied, in words for the customer. The quote is then without it. */
      promoError: string | null;
      totalMinor: number;
      charges: { serviceChargeBps: number; taxBps: number; pricesIncludeCharges: boolean };
    }
  | { ok: false; reason: "empty" | "invalid" }
  | { ok: false; reason: "problems"; lines: QuoteLine[] };

/**
 * Prices a cart for display. The same pricing code prices the real order at checkout, and checkout refuses
 * to place an order whose total differs from the one shown here. The cart holds no prices, so there is
 * nothing for the browser to tamper with. A delivery zone is a name; its fee comes from config, never from the browser.
 * A typed promo code is looked up and priced here too; a code that cannot be used leaves the quote without it and says why.
 */
export type QuoteOptions = { zone?: unknown; fulfilment?: unknown; promoCode?: unknown };
export async function quoteCartAction(raw: unknown, opts: QuoteOptions = {}): Promise<Quote> {
  const zone = opts.zone;
  if (Array.isArray(raw) && raw.length === 0) return { ok: false, reason: "empty" };
  const parsed = cartSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  const lines = parsed.data;

  const items = await withPublicContext((tx) => loadPricingItems(tx, [...new Set(lines.map((l) => l.itemId))]));
  const charges = restaurantConfig.charges;
  const deliveryZone = restaurantConfig.features.delivery && typeof zone === "string" ? restaurantConfig.delivery.zones.find((z) => z.name === zone) : undefined;
  const fee = deliveryZone?.feeMinor ?? 0;

  let promo: { code: string; kind: string; terms: Parameters<typeof priceCart>[4] } | null = null;
  let promoError: string | null = null;
  const typed = typeof opts.promoCode === "string" ? opts.promoCode.trim() : "";
  if (typed) {
    const delivering = opts.fulfilment === "delivery" || !!deliveryZone;
    const found = await previewPromo((await getIdentity())?.ctx ?? null, typed, delivering ? "delivery" : "pickup", restaurantConfig, new Date());
    if (found.ok) promo = { code: found.promo.code, kind: found.promo.kind, terms: found.promo };
    else promoError = promoText(found.reason);
  }
  let priced = priceCart(lines, items, charges, fee, promo?.terms);
  if (!priced.ok && promo && priced.problems.every((p) => p.code === "promo_below_minimum" || p.code === "promo_free_order")) {
    // The code is real but does not fit this order: say so, and show the order without it.
    const below = priced.problems.some((p) => p.code === "promo_below_minimum");
    promoError = promoText(below ? "below_minimum" : "free_order", below ? { min: money(promo.terms!.minOrderMinor) } : {});
    promo = null;
    priced = priceCart(lines, items, charges, fee);
  }
  const byId = new Map(items.map((i) => [i.id, i]));
  const modifierName = (itemId: string, modifierId: string) => {
    for (const g of byId.get(itemId)?.groups ?? []) for (const m of g.modifiers) if (m.id === modifierId) return m;
    return undefined;
  };

  if (!priced.ok) {
    const problems = new Map(priced.problems.map((p) => [p.index, p.code]));
    return {
      ok: false,
      reason: "problems",
      lines: lines.map((l, i) => ({
        key: lineKey(l),
        itemId: l.itemId,
        quantity: l.quantity,
        name: byId.get(l.itemId)?.name ?? null,
        modifiers: l.modifierIds.flatMap((m) => {
          const found = modifierName(l.itemId, m);
          return found ? [{ name: found.name, priceDeltaMinor: found.priceDeltaMinor }] : [];
        }),
        problem: problems.get(i),
      })),
    };
  }

  return {
    ok: true,
    lines: priced.lines.map((l, i) => ({
      key: lineKey(lines[i]),
      itemId: l.itemId,
      quantity: l.quantity,
      name: l.name,
      modifiers: l.modifiers.map((m) => ({ name: m.name, priceDeltaMinor: m.priceDeltaMinor })),
      unitPriceMinor: l.unitPriceMinor,
      lineTotalMinor: l.lineTotalMinor,
    })),
    subtotalMinor: priced.subtotalMinor,
    serviceChargeMinor: priced.serviceChargeMinor,
    taxMinor: priced.taxMinor,
    deliveryFeeMinor: priced.deliveryFeeMinor,
    deliveryZone: deliveryZone?.name ?? null,
    discountMinor: priced.discountMinor,
    deliveryWaivedMinor: priced.deliveryWaivedMinor,
    promo: promo ? { code: promo.code, kind: promo.kind } : null,
    promoError,
    totalMinor: priced.totalMinor,
    charges,
  };
}
