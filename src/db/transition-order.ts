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
  try {
    const rows =
      input.actor.type === "system"
        ? await withSystemContext((tx) => run(tx, input), { url: opts.systemUrl })
        : await withRequestContext(
            { userId: input.actor.id, role: input.actor.type === "staff" ? input.actor.role : "customer" },
            (tx) => run(tx, input),
            { url: opts.appUrl },
          );
    return { status: rows.rows[0].status as OrderStatus };
  } catch (err) {
    throw translate(err);
  }
}
