"use server";

import { z } from "zod";
import { getIdentity } from "@/auth/customer";
import { staffTransitionOrder } from "@/db/staff-actions";
import { ConcurrentTransitionError, IllegalTransitionError, OrderNotFoundError } from "@/domain/orders/transitions";

export type AdvanceResult = { ok: true } | { ok: false; message: string };

const input = z.object({
  code: z.string().regex(/^[A-Za-z0-9]{4,12}$/),
  to: z.enum(["accepted", "preparing", "ready", "picked_up"]),
  from: z.enum(["paid", "accepted", "preparing", "ready"]),
});

/**
 * One tap on the kitchen board. The board names the status it was showing, so if someone else already moved the
 * order the cook is told so instead of the tap silently doing something else. The database decides what is allowed.
 */
export async function advanceOrderAction(code: string, to: string, from: string): Promise<AdvanceResult> {
  const parsed = input.safeParse({ code, to, from });
  if (!parsed.success) return { ok: false, message: "That action is not available." };
  const identity = await getIdentity();
  if (!identity || identity.ctx.role === "customer") return { ok: false, message: "Please sign in again." };
  try {
    await staffTransitionOrder(identity.ctx, parsed.data.code, parsed.data.to, { expectedFrom: parsed.data.from });
    return { ok: true };
  } catch (err) {
    if (err instanceof ConcurrentTransitionError) return { ok: false, message: "Someone else already updated this order. The board has been refreshed." };
    if (err instanceof OrderNotFoundError) return { ok: false, message: "This order is no longer on the board." };
    if (err instanceof IllegalTransitionError) return { ok: false, message: "You cannot do that to this order." };
    throw err;
  }
}
