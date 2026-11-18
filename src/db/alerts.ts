import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { ForbiddenError } from "@/auth/session";
import { withRequestContext, type ContextOptions, type RequestContext, type Tx } from "./context";
import { alerts, auditLog, orders } from "./schema";

export type AlertKind = "payment_mismatch" | "payment_late" | "payment_duplicate" | "refund_failed" | "delivery_failed" | "wallet_low" | "support_question";
export type Alert = {
  id: string;
  kind: string;
  severity: string;
  orderCode: string | null;
  payload: Record<string, unknown>;
  createdAt: Date;
};

/** Raised inside a system transaction when something needs a person (money that could not be applied, for now). */
export async function raiseAlert(
  tx: Tx,
  alert: { kind: AlertKind; severity: "warning" | "critical"; orderId?: string; payload: Record<string, unknown> },
): Promise<void> {
  await tx.insert(alerts).values(alert);
}

function assertManagement(ctx: RequestContext): void {
  if (ctx.role !== "owner" && ctx.role !== "manager") throw new ForbiddenError("Only owners and managers handle alerts");
}

/** Open alerts, most serious first and then oldest first, so the thing waiting longest is at the top. */
export async function listOpenAlerts(ctx: RequestContext, opts?: ContextOptions): Promise<Alert[]> {
  assertManagement(ctx);
  const rows = await withRequestContext(
    ctx,
    (tx) =>
      tx
        .select({ a: alerts, code: orders.publicCode })
        .from(alerts)
        .leftJoin(orders, eq(orders.id, alerts.orderId))
        .where(isNull(alerts.resolvedAt))
        .orderBy(desc(alerts.severity), asc(alerts.createdAt)),
    opts,
  );
  return rows.map(({ a, code }) => ({
    id: a.id,
    kind: a.kind,
    severity: a.severity,
    orderCode: code,
    payload: a.payload as Record<string, unknown>,
    createdAt: a.createdAt,
  }));
}

/** Marks an alert as dealt with. Returns false when it was already resolved (or does not exist). */
export async function resolveAlert(ctx: RequestContext, id: string, opts?: ContextOptions): Promise<boolean> {
  assertManagement(ctx);
  return withRequestContext(
    ctx,
    async (tx) => {
      const done = await tx
        .update(alerts)
        .set({ resolvedAt: new Date(), resolvedBy: ctx.userId })
        .where(and(eq(alerts.id, id), isNull(alerts.resolvedAt)))
        .returning({ id: alerts.id });
      if (done.length === 0) return false;
      await tx.insert(auditLog).values({ actorId: ctx.userId, actorRole: ctx.role, action: "alert.resolved", targetType: "alert", targetId: id });
      return true;
    },
    opts,
  );
}
