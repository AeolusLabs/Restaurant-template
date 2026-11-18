import { eq, sql } from "drizzle-orm";
import { requireRole } from "@/auth/session";
import { generateSlug } from "@/lib/qr";
import { withRequestContext, type ContextOptions, type RequestContext, type Tx } from "./context";
import { auditLog, qrSources } from "./schema";

// What the admin QR screens read and write. Managers and owners only: row-level security enforces it, and every
// function also checks the role so a screen gets a clear refusal. Changes write audit_log in the same
// transaction. A source is switched off, never deleted, so an order's source always points at something.

export class QrInputError extends Error {}
export class QrNotFoundError extends Error {}

export type QrRange = 7 | 30 | 90 | "all";
export type AdminQr = {
  id: string;
  slug: string;
  label: string;
  active: boolean;
  createdAt: Date;
  /** Visits to the code's address in the window. */
  scans: number;
  /** Paid orders placed in the window that this code brought. */
  orders: number;
  /** The total of those orders that were completed (a refunded or unfinished order is not revenue). */
  revenueMinor: number;
};

const isUniqueViolation = (err: unknown) => (err as { cause?: { code?: string } })?.cause?.code === "23505";

const cleanLabel = (raw: string): string => {
  const label = raw.trim();
  if (label.length < 1 || label.length > 120) throw new QrInputError("Give it a name of 1 to 120 characters");
  return label;
};

const sinceOf = (range: QrRange): Date | null => (range === "all" ? null : new Date(Date.now() - range * 86_400_000));

const PAID = sql`exists (select 1 from payments pay where pay.order_id = o.id and pay.status in ('succeeded', 'refunded', 'partially_refunded'))`;

function report(tx: Tx, range: QrRange, only?: string) {
  const since = sinceOf(range);
  return tx.execute(sql`
    select s.id, s.slug, s.label, s.active, s.created_at,
      (select count(*) from qr_scans c where c.source_id = s.id and (${since}::timestamptz is null or c.scanned_at >= ${since}::timestamptz))::int as scans,
      (select count(*) from orders o where o.source_id = s.id and (${since}::timestamptz is null or o.placed_at >= ${since}::timestamptz) and ${PAID})::int as orders,
      (select coalesce(sum(o.total_minor), 0) from orders o where o.source_id = s.id and (${since}::timestamptz is null or o.placed_at >= ${since}::timestamptz) and o.status = 'completed')::bigint as revenue
    from qr_sources s
    ${only ? sql`where s.id = ${only}::uuid` : sql``}
    order by s.created_at desc, s.id desc`);
}

function toAdmin(r: Record<string, unknown>): AdminQr {
  return {
    id: r.id as string,
    slug: r.slug as string,
    label: r.label as string,
    active: r.active as boolean,
    createdAt: new Date(r.created_at as string),
    scans: Number(r.scans),
    orders: Number(r.orders),
    revenueMinor: Number(r.revenue),
  };
}

const record = (tx: Tx, ctx: RequestContext, action: string, slug: string, meta: Record<string, unknown> = {}) =>
  tx.insert(auditLog).values({ actorId: ctx.userId, actorRole: ctx.role, action, targetType: "qr_source", targetId: slug, meta });

/** Every source, newest first, with its numbers for the window. */
export async function listQrSources(ctx: RequestContext, range: QrRange, opts?: ContextOptions): Promise<AdminQr[]> {
  requireRole(ctx, ["owner", "manager"]);
  return (await withRequestContext(ctx, (tx) => report(tx, range), opts)).rows.map(toAdmin);
}

export async function getQrSource(ctx: RequestContext, id: string, range: QrRange, opts?: ContextOptions): Promise<AdminQr | null> {
  requireRole(ctx, ["owner", "manager"]);
  const rows = (await withRequestContext(ctx, (tx) => report(tx, range, id), opts)).rows;
  return rows[0] ? toAdmin(rows[0]) : null;
}

/** Makes a source with a fresh random slug. */
export async function createQrSource(ctx: RequestContext, label: string, opts?: ContextOptions): Promise<{ id: string; slug: string }> {
  requireRole(ctx, ["owner", "manager"]);
  const clean = cleanLabel(label);
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = generateSlug();
    try {
      return await withRequestContext(
        ctx,
        async (tx) => {
          const [row] = await tx.insert(qrSources).values({ slug, label: clean, createdBy: ctx.userId }).returning({ id: qrSources.id });
          await record(tx, ctx, "qr.created", slug, { label: clean });
          return { id: row.id, slug };
        },
        opts,
      );
    } catch (err) {
      if (!isUniqueViolation(err)) throw err; // a taken slug: try another
    }
  }
  throw new Error("Could not allocate a QR slug");
}

export async function renameQrSource(ctx: RequestContext, id: string, label: string, opts?: ContextOptions): Promise<void> {
  requireRole(ctx, ["owner", "manager"]);
  const clean = cleanLabel(label);
  await withRequestContext(
    ctx,
    async (tx) => {
      const done = await tx.update(qrSources).set({ label: clean, updatedAt: new Date() }).where(eq(qrSources.id, id)).returning({ slug: qrSources.slug });
      if (done.length === 0) throw new QrNotFoundError("QR code not found");
      await record(tx, ctx, "qr.renamed", done[0].slug, { label: clean });
    },
    opts,
  );
}

export async function setQrActive(ctx: RequestContext, id: string, active: boolean, opts?: ContextOptions): Promise<void> {
  requireRole(ctx, ["owner", "manager"]);
  await withRequestContext(
    ctx,
    async (tx) => {
      const done = await tx.update(qrSources).set({ active, updatedAt: new Date() }).where(eq(qrSources.id, id)).returning({ slug: qrSources.slug });
      if (done.length === 0) throw new QrNotFoundError("QR code not found");
      await record(tx, ctx, active ? "qr.activated" : "qr.deactivated", done[0].slug);
    },
    opts,
  );
}
