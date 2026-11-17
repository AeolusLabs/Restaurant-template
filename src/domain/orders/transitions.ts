import type { Fulfilment, OrderStatus } from "./statuses";

// The order state machine (docs/ARCHITECTURE.md section 7). This file is the TypeScript copy of the
// matrix. The database holds the enforced copy in order_transitions, and a test fails if they differ.
// The function that applies a transition lives in src/db/transition-order.ts so this file stays pure.

export type ActorKey = "customer" | "kitchen" | "manager" | "owner" | "system";

export type Actor =
  | { type: "customer"; id: string }
  | { type: "staff"; id: string; role: "owner" | "manager" | "kitchen" }
  | { type: "system" };

export type TransitionRule = {
  from: OrderStatus;
  to: OrderStatus;
  /** Omitted means the rule applies to both pickup and delivery orders. */
  fulfilment?: Fulfilment;
  actors: readonly ActorKey[];
};

const STAFF: readonly ActorKey[] = ["kitchen", "manager", "owner"];
const MANAGEMENT: readonly ActorKey[] = ["manager", "owner"];

export const TRANSITIONS: readonly TransitionRule[] = [
  { from: "placed", to: "paid", actors: ["system"] },
  { from: "placed", to: "cancelled", actors: ["system", "customer"] },
  { from: "paid", to: "accepted", actors: STAFF },
  { from: "paid", to: "cancelled", actors: ["customer", ...MANAGEMENT] },
  { from: "accepted", to: "preparing", actors: STAFF },
  { from: "accepted", to: "cancelled", actors: MANAGEMENT },
  { from: "preparing", to: "ready", actors: STAFF },
  { from: "ready", to: "out_for_delivery", fulfilment: "delivery", actors: ["system"] },
  { from: "ready", to: "picked_up", fulfilment: "pickup", actors: STAFF },
  { from: "out_for_delivery", to: "completed", fulfilment: "delivery", actors: ["system", ...MANAGEMENT] },
  { from: "picked_up", to: "completed", fulfilment: "pickup", actors: ["system", ...MANAGEMENT] },
  // A paid delivery order whose delivery fails needs a state an admin can act on.
  { from: "accepted", to: "delivery_failed", fulfilment: "delivery", actors: ["system"] },
  { from: "preparing", to: "delivery_failed", fulfilment: "delivery", actors: ["system"] },
  { from: "ready", to: "delivery_failed", fulfilment: "delivery", actors: ["system"] },
  { from: "out_for_delivery", to: "delivery_failed", fulfilment: "delivery", actors: ["system"] },
  // Retry returns to the stored resume_state, which the database function enforces.
  { from: "delivery_failed", to: "accepted", actors: MANAGEMENT },
  { from: "delivery_failed", to: "preparing", actors: MANAGEMENT },
  { from: "delivery_failed", to: "ready", actors: MANAGEMENT },
  { from: "delivery_failed", to: "out_for_delivery", actors: MANAGEMENT },
  { from: "delivery_failed", to: "cancelled", actors: MANAGEMENT },
  { from: "cancelled", to: "refunded", actors: MANAGEMENT },
  { from: "completed", to: "refunded", actors: MANAGEMENT },
];

export function actorKey(actor: Actor): ActorKey {
  if (actor.type === "staff") return actor.role;
  return actor.type;
}

/** Pure check against the matrix. The database function makes the binding decision. */
export function canTransition(from: OrderStatus, to: OrderStatus, fulfilment: Fulfilment, actor: Actor): boolean {
  const key = actorKey(actor);
  return TRANSITIONS.some(
    (r) => r.from === from && r.to === to && r.actors.includes(key) && (!r.fulfilment || r.fulfilment === fulfilment),
  );
}

export class IllegalTransitionError extends Error {}
export class OrderNotFoundError extends Error {}
/** The order was no longer in the status the caller expected. Someone else changed it first. */
export class ConcurrentTransitionError extends Error {}
