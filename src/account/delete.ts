import { and, eq, inArray, or, sql } from "drizzle-orm";
import { getAuth, type Auth } from "@/auth/auth";
import { withSystemContext, type RequestContext } from "@/db/context";
import { auditLog, dataRequests, orderContacts, orders, payments, webhookEvents } from "@/db/schema";
import { transitionOrderIn } from "@/db/transition-order";

// NDPR / GDPR deletion (docs/ARCHITECTURE.md section 14). Orders and payments are financial records, so
// they stay, stripped of everything that identifies the customer. The auth user is removed last: its
// foreign keys cascade through the profile, sessions, consents and addresses, and set orders.profile_id null.

export class ActiveOrderError extends Error {}

const IN_PROGRESS = ["paid", "accepted", "preparing", "ready", "out_for_delivery", "picked_up", "delivery_failed"] as const;

export async function deleteCustomerAccount(
  ctx: RequestContext,
  deps: { auth?: Auth; systemUrl?: string; appUrl?: string } = {},
): Promise<void> {
  if (ctx.role !== "customer") throw new Error("Only customer accounts can be deleted here");
  const auth = deps.auth ?? getAuth();
  const sys = { url: deps.systemUrl };

  const requestId = await withSystemContext(async (tx) => {
    const busy = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.profileId, ctx.userId), inArray(orders.status, [...IN_PROGRESS])))
      .limit(1);
    if (busy.length > 0) {
      throw new ActiveOrderError("You have an order in progress. You can delete your account once it is complete.");
    }

    const [request] = await tx.insert(dataRequests).values({ profileId: ctx.userId, kind: "delete" }).returning({ id: dataRequests.id });

    // An order that was never paid will never be collected, so close it rather than leave it waiting.
    const unpaid = await tx.select({ id: orders.id }).from(orders).where(and(eq(orders.profileId, ctx.userId), eq(orders.status, "placed")));
    for (const o of unpaid) {
      await transitionOrderIn(tx, { orderId: o.id, to: "cancelled", actor: { type: "system" }, reason: "account deleted" });
    }

    const mine = tx.select({ id: orders.id }).from(orders).where(eq(orders.profileId, ctx.userId));
    const refs = (await tx.select({ reference: payments.reference }).from(payments).where(inArray(payments.orderId, mine))).map((r) => r.reference);

    await tx.update(orders).set({ customerName: "Deleted customer", notes: null }).where(eq(orders.profileId, ctx.userId));
    await tx.update(orderContacts).set({ phone: "", addressSnapshot: {} }).where(inArray(orderContacts.orderId, mine));
    if (refs.length > 0) {
      // The provider's stored webhook bodies include the customer's email.
      await tx
        .update(webhookEvents)
        .set({ payload: { redacted: true } })
        .where(
          or(
            inArray(sql`${webhookEvents.payload}->'data'->>'reference'`, refs),
            inArray(sql`${webhookEvents.payload}->'data'->>'transaction_reference'`, refs),
          ),
        );
    }
    await tx.insert(auditLog).values({ actorRole: "system", action: "account.deleted", targetType: "profile", targetId: ctx.userId });
    return request.id;
  }, sys);

  await (await auth.$context).internalAdapter.deleteUser(ctx.userId);
  await withSystemContext(
    (tx) => tx.update(dataRequests).set({ status: "completed", completedAt: new Date() }).where(eq(dataRequests.id, requestId)),
    sys,
  );
}
