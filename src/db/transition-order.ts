import { sql } from "drizzle-orm";
import {
  ConcurrentTransitionError,
  IllegalTransitionError,
  OrderNotFoundError,
  type Actor,
} from "@/domain/orders/transitions";
import type { OrderStatus } from "@/domain/orders/statuses";
import { withRequestContext, withSystemContext, type Tx } from "./context";

export type TransitionInput = {
  orderId: string;
  to: OrderStatus;
  actor: Actor;
  /** Fail with ConcurrentTransitionError unless the order is still in this status. */
  expectedFrom?: OrderStatus;
  reason?: string;
  meta?: Record<string, unknown>;
};

export type TransitionOptions = { appUrl?: string; systemUrl?: string };

const run = (tx: Tx, i: TransitionInput) =>
  tx.execute(
    sql`select transition_order(${i.orderId}::uuid, ${i.to}::order_status, ${i.expectedFrom ?? null}::order_status, ${i.reason ?? null}, ${JSON.stringify(i.meta ?? {})}::jsonb) as status`,
  );

function translate(err: unknown): Error {
  const e = err as { cause?: { code?: string; message?: string }; message?: string };
  const code = e.cause?.code;
  const message = e.cause?.message ?? e.message ?? "order transition failed";
  if (code === "OT001" || code === "42501") return new IllegalTransitionError(message);
  if (code === "OT002") return new ConcurrentTransitionError(message);
  if (code === "P0002") return new OrderNotFoundError(message);
  return err instanceof Error ? err : new Error(message);
}

/**
 * The only function that changes orders.status. The database decides: it locks the row, checks the
 * actor and fulfilment against order_transitions, updates the order and writes the order_events row
 * in one transaction. The actor's identity is taken from the request context, not from an argument.
 */
export async function transitionOrder(input: TransitionInput, opts: TransitionOptions = {}): Promise<{ status: OrderStatus }> {
  return input.actor.type === "system"
    ? withSystemContext((tx) => transitionOrderIn(tx, input), { url: opts.systemUrl })
    : withRequestContext(
        { userId: input.actor.id, role: input.actor.type === "staff" ? input.actor.role : "customer" },
        (tx) => transitionOrderIn(tx, input),
        { url: opts.appUrl },
      );
}

/**
 * The same transition inside a transaction the caller already opened, so a webhook can record the event,
 * the payment and the status change atomically. The transaction must have been opened with the context of
 * input.actor (the database reads the actor from it, not from this argument).
 */
export async function transitionOrderIn(tx: Tx, input: TransitionInput): Promise<{ status: OrderStatus }> {
  try {
    const rows = await run(tx, input);
    return { status: rows.rows[0].status as OrderStatus };
  } catch (err) {
    throw translate(err);
  }
}
