"use server";

import { z } from "zod";
import { requireStaff } from "@/auth/customer";
import { staffTransitionOrder } from "@/db/staff-actions";
import { ConcurrentTransitionError, IllegalTransitionError, OrderNotFoundError } from "@/domain/orders/transitions";
import { text } from "@/lib/form";
import { redirectWith } from "@/lib/notice";
import { RefundError, cancelAndRefund, refundOrder } from "@/payments/refund";

const CODE = /^[A-Za-z0-9]{4,12}$/;
const back = (code: string) => `/admin/orders/${code}`;

function explain(err: unknown): string {
  if (err instanceof ConcurrentTransitionError) return "Someone else already changed this order. It is shown as it is now.";
  if (err instanceof IllegalTransitionError) return "You cannot do that to this order.";
  if (err instanceof OrderNotFoundError) return "That order could not be found.";
  if (err instanceof RefundError) return err.message;
  throw err;
}

const step = z.object({
  code: z.string().regex(CODE),
  to: z.enum(["accepted", "preparing", "ready", "picked_up", "completed"]),
  from: z.string().min(1),
});

/** Moves an order forward. The page names the status it was showing, so a stale page cannot act on a newer order. */
export async function transitionAction(formData: FormData): Promise<void> {
  const parsed = step.safeParse({ code: text(formData, "code"), to: text(formData, "to"), from: text(formData, "from") });
  if (!parsed.success) redirectWith("/admin/orders", { error: "That action is not available." });
  const { ctx } = await requireStaff(["owner", "manager"], "/admin/orders");
  const { code, to, from } = parsed.data!;
  try {
    await staffTransitionOrder(ctx, code, to, { expectedFrom: from as never });
  } catch (err) {
    redirectWith(back(code), { error: explain(err) });
  }
  redirectWith(back(code), { notice: "Order updated." });
}

/** Cancels a paid or accepted order and returns the customer's money. */
export async function cancelAndRefundAction(formData: FormData): Promise<void> {
  const code = text(formData, "code");
  if (!CODE.test(code)) redirectWith("/admin/orders", { error: "That order could not be found." });
  const { ctx } = await requireStaff(["owner", "manager"], "/admin/orders");
  const reason = text(formData, "reason").trim().slice(0, 200) || "cancelled by staff";
  let refunded: boolean;
  try {
    ({ refunded } = await cancelAndRefund(ctx, code, { reason }));
  } catch (err) {
    redirectWith(back(code), { error: explain(err) });
  }
  redirectWith(
    back(code),
    refunded ? { notice: "Order cancelled and the customer has been refunded." } : { error: "Order cancelled, but the refund did not go through. Try the refund again from this page." },
  );
}

/** Refunds a cancelled or completed order in full. */
export async function refundAction(formData: FormData): Promise<void> {
  const code = text(formData, "code");
  if (!CODE.test(code)) redirectWith("/admin/orders", { error: "That order could not be found." });
  const { ctx } = await requireStaff(["owner", "manager"], "/admin/orders");
  const reason = text(formData, "reason").trim().slice(0, 200) || undefined;
  try {
    await refundOrder({ type: "staff", ctx }, code, { reason });
  } catch (err) {
    redirectWith(back(code), { error: explain(err) });
  }
  redirectWith(back(code), { notice: "Refund sent. The customer's bank can take a few days to show it." });
}
