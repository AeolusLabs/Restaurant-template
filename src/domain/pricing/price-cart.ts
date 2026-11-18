import { applyBps, assertMinor, extractInclusiveBps } from "../../lib/money";
import { applyPromo, type PromoTerms } from "../promos/rules";

// Prices a cart from menu data the server loaded. The browser never sends a price: a cart line is only
// an item id, modifier ids and a quantity. Pure: no database, no HTTP. See docs/ARCHITECTURE.md section 6
// and rulings 1 in docs/superpowers/plans/2026-11-17-phase-2-customer-side.md for the charge order.

export const MAX_LINE_QUANTITY = 20;

export type PricingModifier = { id: string; name: string; priceDeltaMinor: number; available: boolean };
export type PricingGroup = { id: string; name: string; minSelect: number; maxSelect: number; modifiers: PricingModifier[] };
export type PricingItem = {
  id: string;
  name: string;
  priceMinor: number;
  active: boolean;
  available: boolean;
  groups: PricingGroup[];
};

export type CartLine = { itemId: string; quantity: number; modifierIds: string[] };
export type Charges = { serviceChargeBps: number; taxBps: number; pricesIncludeCharges: boolean };

export type PricedLine = {
  itemId: string;
  name: string;
  quantity: number;
  /** Item price plus the chosen modifier deltas, for one unit. */
  unitPriceMinor: number;
  modifiers: { id: string; name: string; priceDeltaMinor: number }[];
  lineTotalMinor: number;
};

export type ProblemCode =
  | "empty_cart"
  | "not_found"
  | "inactive"
  | "sold_out"
  | "quantity"
  | "modifier_invalid"
  | "modifier_unavailable"
  | "selection_count"
  | "promo_below_minimum"
  | "promo_free_order";
/** index is the cart line the problem belongs to, or -1 for the cart as a whole. */
export type LineProblem = { index: number; code: ProblemCode };

export type PriceResult =
  | {
      ok: true;
      lines: PricedLine[];
      /** The items before any discount. */
      subtotalMinor: number;
      /** What a percentage or fixed promo took off the items. Charges are worked out after it. */
      discountMinor: number;
      serviceChargeMinor: number;
      taxMinor: number;
      /** What the customer pays for delivery: zero when a free-delivery promo waived it. */
      deliveryFeeMinor: number;
      /** What a free-delivery promo waived, for the record. */
      deliveryWaivedMinor: number;
      totalMinor: number;
    }
  | { ok: false; problems: LineProblem[] };

function priceLine(line: CartLine, item: PricingItem | undefined): PricedLine | ProblemCode {
  if (!item) return "not_found";
  if (!item.active) return "inactive";
  if (!item.available) return "sold_out";
  if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > MAX_LINE_QUANTITY) return "quantity";

  const known = new Map<string, { groupId: string; modifier: PricingModifier }>();
  for (const g of item.groups) for (const m of g.modifiers) known.set(m.id, { groupId: g.id, modifier: m });

  const chosen: PricingModifier[] = [];
  const perGroup = new Map<string, number>();
  const seen = new Set<string>();
  for (const id of line.modifierIds) {
    const hit = known.get(id);
    if (!hit || seen.has(id)) return "modifier_invalid";
    seen.add(id);
    if (!hit.modifier.available) return "modifier_unavailable";
    chosen.push(hit.modifier);
    perGroup.set(hit.groupId, (perGroup.get(hit.groupId) ?? 0) + 1);
  }
  for (const g of item.groups) {
    const n = perGroup.get(g.id) ?? 0;
    if (n < g.minSelect || n > g.maxSelect) return "selection_count";
  }

  const unitPriceMinor = chosen.reduce((sum, m) => sum + m.priceDeltaMinor, item.priceMinor);
  assertMinor(unitPriceMinor);
  const lineTotalMinor = unitPriceMinor * line.quantity;
  assertMinor(lineTotalMinor);
  return {
    itemId: item.id,
    name: item.name,
    quantity: line.quantity,
    unitPriceMinor,
    modifiers: chosen.map((m) => ({ id: m.id, name: m.name, priceDeltaMinor: m.priceDeltaMinor })),
    lineTotalMinor,
  };
}

/**
 * Prices the cart. `deliveryFeeMinor` is the zone's fee for a delivery order (from config, never from the
 * browser). It is added after charges and is not taxed. An applied promo comes off the items before charges are
 * worked out, or waives the delivery fee.
 */
export function priceCart(lines: readonly CartLine[], menu: readonly PricingItem[], charges: Charges, deliveryFeeMinor = 0, promo?: PromoTerms): PriceResult {
  assertMinor(deliveryFeeMinor);
  if (deliveryFeeMinor < 0) throw new RangeError("The delivery fee cannot be negative");
  if (lines.length === 0) return { ok: false, problems: [{ index: -1, code: "empty_cart" }] };

  const byId = new Map(menu.map((i) => [i.id, i]));
  const priced: PricedLine[] = [];
  const problems: LineProblem[] = [];
  lines.forEach((line, index) => {
    const r = priceLine(line, byId.get(line.itemId));
    if (typeof r === "string") problems.push({ index, code: r });
    else priced.push(r);
  });
  if (problems.length > 0) return { ok: false, problems };

  const subtotalMinor = priced.reduce((sum, l) => sum + l.lineTotalMinor, 0);
  assertMinor(subtotalMinor);

  let discountMinor = 0;
  let deliveryWaivedMinor = 0;
  if (promo) {
    const applied = applyPromo(promo, subtotalMinor, deliveryFeeMinor);
    if (!applied.ok) return { ok: false, problems: [{ index: -1, code: "promo_below_minimum" }] };
    discountMinor = applied.itemDiscountMinor;
    deliveryWaivedMinor = applied.deliveryWaivedMinor;
  }
  const chargeable = subtotalMinor - discountMinor;
  const feeMinor = deliveryFeeMinor - deliveryWaivedMinor;

  let serviceChargeMinor: number;
  let taxMinor: number;
  let totalMinor: number;
  if (charges.pricesIncludeCharges) {
    // The price already contains both. Tax sits on top of the service charge, so take it out first.
    taxMinor = extractInclusiveBps(chargeable, charges.taxBps);
    serviceChargeMinor = extractInclusiveBps(chargeable - taxMinor, charges.serviceChargeBps);
    totalMinor = chargeable;
  } else {
    serviceChargeMinor = applyBps(chargeable, charges.serviceChargeBps);
    taxMinor = applyBps(chargeable + serviceChargeMinor, charges.taxBps);
    totalMinor = chargeable + serviceChargeMinor + taxMinor;
  }
  totalMinor += feeMinor;
  assertMinor(totalMinor);
  // Nothing could be paid for a free order, so a promo that makes one is refused.
  if (promo && totalMinor <= 0) return { ok: false, problems: [{ index: -1, code: "promo_free_order" }] };
  return { ok: true, lines: priced, subtotalMinor, discountMinor, serviceChargeMinor, taxMinor, deliveryFeeMinor: feeMinor, deliveryWaivedMinor, totalMinor };
}
