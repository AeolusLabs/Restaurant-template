import { desc, eq, sql } from "drizzle-orm";
import { requireRole } from "@/auth/session";
import type { PromoFields } from "@/domain/promos/form";
import { withRequestContext, type ContextOptions, type RequestContext, type Tx } from "./context";
import { auditLog, promoRedemptions, promos } from "./schema";

// What the admin promo screens read and write. Managers and owners only: row-level security enforces it, and
// every function also checks the role so a screen gets a clear refusal. Changes write audit_log in the same
// transaction. Promos are switched off, never deleted.

export class PromoCodeTakenError extends Error {}
export class PromoNotFoundError extends Error {}

export type AdminPromo = PromoFields & {
  id: string;
  createdAt: Date;
  /** Uses in force: released ones (order cancelled unpaid) are not counted. */
  redemptions: number;
  /** What the promo has taken off orders in total (the waived fee for free delivery). */
  discountGivenMinor: number;
};

const isUniqueViolation = (err: unknown) => (err as { cause?: { code?: string } })?.cause?.code === "23505";

const uses = sql<number>`count(${promoRedemptions.id}) filter (where ${promoRedemptions.releasedAt} is null)`.mapWith(Number);
const given = sql<number>`coalesce(sum(${promoRedemptions.discountMinor}) filter (where ${promoRedemptions.releasedAt} is null), 0)`.mapWith(Number);

const select = (tx: Tx) =>
  tx
    .select({ p: promos, uses, given })
    .from(promos)
    .leftJoin(promoRedemptions, eq(promoRedemptions.promoId, promos.id))
    .groupBy(promos.id);

function toAdmin(r: { p: typeof promos.$inferSelect; uses: number; given: number }): AdminPromo {
  const p = r.p;
  return {
    id: p.id,
    code: p.code,
    description: p.description,
    kind: p.kind as PromoFields["kind"],
    value: p.value,
    minOrderMinor: p.minOrderMinor,
    maxDiscountMinor: p.maxDiscountMinor,
    startsAt: p.startsAt,
    expiresAt: p.expiresAt,
    maxRedemptions: p.maxRedemptions,
    maxPerCustomer: p.maxPerCustomer,
    active: p.active,
    createdAt: p.createdAt,
    redemptions: r.uses,
    discountGivenMinor: r.given,
  };
}

const values = (f: PromoFields) => ({
  code: f.code,
  description: f.description,
  kind: f.kind,
  value: f.value,
  minOrderMinor: f.minOrderMinor,
  maxDiscountMinor: f.maxDiscountMinor,
  startsAt: f.startsAt,
  expiresAt: f.expiresAt,
  maxRedemptions: f.maxRedemptions,
  maxPerCustomer: f.maxPerCustomer,
  active: f.active,
});

const record = (tx: Tx, ctx: RequestContext, action: string, code: string, meta: Record<string, unknown> = {}) =>
  tx.insert(auditLog).values({ actorId: ctx.userId, actorRole: ctx.role, action, targetType: "promo", targetId: code, meta });

/** Every promo, newest first, with how often it is in use. */
export async function listPromos(ctx: RequestContext, opts?: ContextOptions): Promise<AdminPromo[]> {
  requireRole(ctx, ["owner", "manager"]);
  const rows = await withRequestContext(ctx, (tx) => select(tx).orderBy(desc(promos.createdAt)), opts);
  return rows.map(toAdmin);
}

export async function getPromo(ctx: RequestContext, id: string, opts?: ContextOptions): Promise<AdminPromo | null> {
  requireRole(ctx, ["owner", "manager"]);
  const rows = await withRequestContext(ctx, (tx) => select(tx).where(eq(promos.id, id)), opts);
  return rows[0] ? toAdmin(rows[0]) : null;
}

export async function createPromo(ctx: RequestContext, f: PromoFields, opts?: ContextOptions): Promise<{ id: string }> {
  requireRole(ctx, ["owner", "manager"]);
  try {
    return await withRequestContext(
      ctx,
      async (tx) => {
        const [row] = await tx.insert(promos).values({ ...values(f), createdBy: ctx.userId }).returning({ id: promos.id });
        await record(tx, ctx, "promo.created", f.code, { kind: f.kind });
        return row;
      },
      opts,
    );
  } catch (err) {
    if (isUniqueViolation(err)) throw new PromoCodeTakenError("A promo with that code already exists");
    throw err;
  }
}

export async function updatePromo(ctx: RequestContext, id: string, f: PromoFields, opts?: ContextOptions): Promise<void> {
  requireRole(ctx, ["owner", "manager"]);
  try {
    await withRequestContext(
      ctx,
      async (tx) => {
        const done = await tx.update(promos).set({ ...values(f), updatedAt: new Date() }).where(eq(promos.id, id)).returning({ id: promos.id });
        if (done.length === 0) throw new PromoNotFoundError("Promo not found");
        await record(tx, ctx, "promo.updated", f.code, { kind: f.kind });
      },
      opts,
    );
  } catch (err) {
    if (isUniqueViolation(err)) throw new PromoCodeTakenError("A promo with that code already exists");
    throw err;
  }
}

export async function setPromoActive(ctx: RequestContext, id: string, active: boolean, opts?: ContextOptions): Promise<void> {
  requireRole(ctx, ["owner", "manager"]);
  await withRequestContext(
    ctx,
    async (tx) => {
      const done = await tx.update(promos).set({ active, updatedAt: new Date() }).where(eq(promos.id, id)).returning({ code: promos.code });
      if (done.length === 0) throw new PromoNotFoundError("Promo not found");
      await record(tx, ctx, active ? "promo.activated" : "promo.deactivated", done[0].code);
    },
    opts,
  );
}
