import type { OrderStatus } from "./statuses";

// How an order's status is explained to the customer. Plain, short, no exclamation marks. Pure, so the
// wording and the progress steps are tested without a browser.

export type Tone = "info" | "ok" | "warn" | "bad";

export const PICKUP_STEPS: readonly { status: OrderStatus; label: string }[] = [
  { status: "placed", label: "Order placed" },
  { status: "paid", label: "Paid" },
  { status: "accepted", label: "Accepted" },
  { status: "preparing", label: "Being prepared" },
  { status: "ready", label: "Ready for pickup" },
  { status: "picked_up", label: "Collected" },
];

const TEXT: Record<OrderStatus, { headline: string; detail: string; tone: Tone }> = {
  placed: {
    headline: "Waiting for payment",
    detail: "If you have just paid, this page updates in a few seconds. If not, you can pay below.",
    tone: "info",
  },
  paid: {
    headline: "Payment received",
    detail: "The restaurant will accept your order shortly.",
    tone: "ok",
  },
  accepted: {
    headline: "Order accepted",
    detail: "The kitchen has your order and will start on it soon.",
    tone: "ok",
  },
  preparing: {
    headline: "Being prepared",
    detail: "Your food is being made. We will show here when it is ready.",
    tone: "ok",
  },
  ready: {
    headline: "Ready for pickup",
    detail: "Come to the counter and show your order code.",
    tone: "ok",
  },
  out_for_delivery: {
    headline: "On its way",
    detail: "A rider has collected your order.",
    tone: "ok",
  },
  picked_up: {
    headline: "Collected",
    detail: "Thank you. We hope you enjoy your meal.",
    tone: "ok",
  },
  completed: {
    headline: "Completed",
    detail: "Thank you. We hope you enjoyed your meal.",
    tone: "ok",
  },
  cancelled: {
    headline: "Order cancelled",
    detail: "This order was not completed. If you were charged, the restaurant will refund you.",
    tone: "bad",
  },
  delivery_failed: {
    headline: "Delivery problem",
    detail: "We could not deliver this order. The restaurant is sorting it out and may contact you.",
    tone: "warn",
  },
  refunded: {
    headline: "Refunded",
    detail: "Your payment has been returned. It can take a few days to show in your account.",
    tone: "warn",
  },
};

export const describeStatus = (status: OrderStatus) => TEXT[status];

/** Which progress step the order is on, or null when it left the normal path (cancelled, refunded). */
export function stepIndex(status: OrderStatus): number | null {
  if (status === "completed") return PICKUP_STEPS.length - 1;
  const i = PICKUP_STEPS.findIndex((s) => s.status === status);
  return i === -1 ? null : i;
}

/** Whether the order can still change in a way the customer should be shown. Polling stops when it cannot. */
export const isFinished = (status: OrderStatus): boolean => status === "completed" || status === "cancelled" || status === "refunded";

/** Whether an unpaid order can still be paid: it is waiting for payment and its hold has not run out. */
export function isPayable(order: { status: OrderStatus; expiresAt: Date | null }, now: Date): boolean {
  return order.status === "placed" && (!order.expiresAt || order.expiresAt.getTime() > now.getTime());
}

const STAFF_LABEL: Record<OrderStatus, string> = {
  placed: "Unpaid",
  paid: "New",
  accepted: "Accepted",
  preparing: "Preparing",
  ready: "Ready",
  out_for_delivery: "Out for delivery",
  picked_up: "Collected",
  completed: "Completed",
  cancelled: "Cancelled",
  delivery_failed: "Delivery failed",
  refunded: "Refunded",
};

/** A short word for an order's status on staff screens: "New" means paid and waiting to be accepted. */
export const staffLabel = (status: OrderStatus): string => STAFF_LABEL[status];
