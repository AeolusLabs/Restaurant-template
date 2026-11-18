import { sql } from "drizzle-orm";
import type { RestaurantConfig } from "../../config/schema";
import { normalizeCode, promoRejection, type Promo, type PromoKind, type PromoProblem } from "@/domain/promos/rules";
import type { Tx } from "./context";

export type PromoRow = Promo & { id: string };

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const date = (v: unknown): Date | null => (v === null || v === undefined ? null : new Date(v as string | Date));

/** A row from promo_for_code() or the promos table, as the domain's Promo. Money columns come back from pg as text. */
export function toPromo(r: Record<string, unknown>): PromoRow {
  return {
    id: r.id as string,
    code: r.code as string,
    kind: r.kind as PromoKind,
    value: num(r.value),
    minOrderMinor: Number(r.min_order_minor),
    maxDiscountMinor: num(r.max_discount_minor),
    active: r.active as boolean,
    startsAt: date(r.starts_at),
    expiresAt: date(r.expires_at),
    maxRedemptions: num(r.max_redemptions),
    maxPerCustomer: num(r.max_per_customer),
  };
}

export type PromoLookup = { ok: true; promo: PromoRow } | { ok: false; reason: PromoProblem };

/**
 * Finds the promo for a typed code and says whether this customer may use it now. Inside the order's own
 * transaction, under a lock on the code, so two orders cannot both take the last use: the second waits, then
 * sees the first one's redemption.
 */
export async function lookupPromoForOrder(
  tx: Tx,
  profileId: string,
  rawCode: string,
  fulfilment: "pickup" | "delivery",
  cfg: Pick<RestaurantConfig, "features">,
  now: Date,
): Promise<PromoLookup> {
  if (!cfg.features.promos) return { ok: false, reason: "disabled" };
  const code = normalizeCode(rawCode);
  if (!code) return { ok: false, reason: "unknown" };
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`promo:${code}`}, 0))`);
  const found = (await tx.execute(sql`select * from promo_for_code(${code})`)).rows[0];
  if (!found) return { ok: false, reason: "unknown" };
  const promo = toPromo(found);
  const used = (await tx.execute(sql`select total, mine from promo_usage(${promo.id}::uuid, ${profileId}::uuid)`)).rows[0] as { total: number; mine: number };
  const reason = promoRejection(promo, { now, usage: { total: Number(used.total), mine: Number(used.mine) }, fulfilment });
  return reason ? { ok: false, reason } : { ok: true, promo };
}
