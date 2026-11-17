import { eq } from "drizzle-orm";
import { ForbiddenError } from "@/auth/session";
import type { OrderStatus } from "@/domain/orders/statuses";
import { OrderNotFoundError } from "@/domain/orders/transitions";
import { withRequestContext, type RequestContext } from "./context";
import { auditLog, orders } from "./schema";
import { transitionOrderIn } from "./transition-order";

/** Steps the order history already records well enough. Everything else a manager does is also audited. */
const ROUTINE: ReadonlySet<OrderStatus> = new Set(["accepted", "preparing", "ready", "picked_up"]);

export type StaffTransitionOptions = {
  /** The status the person's screen showed. If the order has moved on since, the action is refused. */
  expectedFrom?: OrderStatus;
  reason?: string;
};

/**
 * A staff member moves an order to its next status. The database decides whether they may (state machine and
 * role), and the order is locked while it checks, so two people acting at once cannot both succeed. Cancels and
 * other management actions are also written to the audit log, in the same transaction.
 */
export async function staffTransitionOrder(
  ctx: RequestContext,
  publicCode: string,
  to: OrderStatus,
  options: StaffTransitionOptions = {},
  deps: { appUrl?: string } = {},
): Promise<{ status: OrderStatus }> {
  if (ctx.role === "customer") throw new ForbiddenError("Only staff can change an order's status");
  const actor = { type: "staff", id: ctx.userId, role: ctx.role } as const;

  return withRequestContext(
    ctx,
    async (tx) => {
      const [found] = await tx.select({ id: orders.id, status: orders.status }).from(orders).where(eq(orders.publicCode, publicCode)).limit(1);
      if (!found) throw new OrderNotFoundError("Order not found");
      const result = await transitionOrderIn(tx, { orderId: found.id, to, actor, expectedFrom: options.expectedFrom, reason: options.reason });
      if (!ROUTINE.has(to)) {
        await tx.insert(auditLog).values({
          actorId: ctx.userId,
          actorRole: ctx.role,
          action: `order.${to}`,
          targetType: "order",
          targetId: publicCode,
          meta: { from: found.status, to, ...(options.reason ? { reason: options.reason } : {}) },
        });
      }
      return result;
    },
    { url: deps.appUrl },
  );
}
