import type { Fulfilment, OrderStatus } from "./statuses";
import { TRANSITIONS, canTransition } from "./transitions";

// What a staff member may do next with an order. Derived from the state machine (TRANSITIONS), never copied,
// so the screens cannot offer what the database would refuse. Pure.

export type StaffRole = "kitchen" | "manager" | "owner";
export type OrderAction = { to: OrderStatus; label: string; needsConfirm: boolean };

const LABELS: Partial<Record<OrderStatus, string>> = {
  accepted: "Accept order",
  preparing: "Start preparing",
  ready: "Mark ready",
  picked_up: "Handed over",
  completed: "Mark completed",
  cancelled: "Cancel order",
};

// Refunds are a separate action (they move money), and the rest are the system's or delivery's job.
const NOT_A_BUTTON: ReadonlySet<OrderStatus> = new Set(["refunded", "delivery_failed", "out_for_delivery"]);

export function nextActions(role: StaffRole, status: OrderStatus, fulfilment: Fulfilment): OrderAction[] {
  const actor = { type: "staff", id: "", role } as const;
  const targets = [...new Set(TRANSITIONS.filter((r) => r.from === status).map((r) => r.to))].filter(
    (to) => !NOT_A_BUTTON.has(to) && canTransition(status, to, fulfilment, actor),
  );
  return targets
    .map((to) => ({ to, label: LABELS[to] ?? to, needsConfirm: to === "cancelled" }))
    .sort((a, b) => Number(a.needsConfirm) - Number(b.needsConfirm));
}

/** A refund returns money, so it is for managers and owners, after the order is cancelled or completed. */
export function canRefund(role: StaffRole, status: OrderStatus): boolean {
  return (role === "manager" || role === "owner") && (status === "cancelled" || status === "completed");
}
