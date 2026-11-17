"use server";

import { restaurantConfig } from "../../../../config/restaurant";
import { withPublicContext } from "@/db/context";
import { loadPricingItems } from "@/db/menu";
import { cartSchema } from "@/domain/checkout/cart";
import { lineKey } from "@/domain/checkout/line-key";
import { priceCart, type ProblemCode } from "@/domain/pricing/price-cart";

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
      totalMinor: number;
      charges: { serviceChargeBps: number; taxBps: number; pricesIncludeCharges: boolean };
    }
  | { ok: false; reason: "empty" | "invalid" }
  | { ok: false; reason: "problems"; lines: QuoteLine[] };

/**
 * Prices a cart for display. The same pricing code prices the real order at checkout, and checkout refuses
 * to place an order whose total differs from the one shown here. The cart holds no prices, so there is
 * nothing for the browser to tamper with.
 */
export async function quoteCartAction(raw: unknown): Promise<Quote> {
  if (Array.isArray(raw) && raw.length === 0) return { ok: false, reason: "empty" };
  const parsed = cartSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  const lines = parsed.data;

  const items = await withPublicContext((tx) => loadPricingItems(tx, [...new Set(lines.map((l) => l.itemId))]));
  const charges = restaurantConfig.charges;
  const priced = priceCart(lines, items, charges);
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
    totalMinor: priced.totalMinor,
    charges,
  };
}
