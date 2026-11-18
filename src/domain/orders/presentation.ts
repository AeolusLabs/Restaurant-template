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

export const DELIVERY_STEPS: readonly { status: OrderStatus; label: string }[] = [
  { status: "placed", label: "Order placed" },
  { status: "paid", label: "Paid" },
  { status: "accepted", label: "Accepted" },
  { status: "preparing", label: "Being prepared" },
  { status: "ready", label: "Ready for the rider" },
  { status: "out_for_delivery", label: "On its way" },
  { status: "completed", label: "Delivered" },
];

/** The steps a customer sees for this kind of order. */
export const stepsFor = (fulfilment: string) => (fulfilment === "delivery" ? DELIVERY_STEPS : PICKUP_STEPS);

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

// Where delivery has its own words: nobody collects a delivery at the counter.
const DELIVERY_TEXT: Partial<Record<OrderStatus, { headline: string; detail: string; tone: Tone }>> = {
  ready: { headline: "Ready for the rider", detail: "Your order is packed. The rider will collect it shortly.", tone: "ok" },
  completed: { headline: "Delivered", detail: "Your order has been delivered. We hope you enjoy your meal.", tone: "ok" },
};

export const describeStatus = (status: OrderStatus, fulfilment = "pickup") => (fulfilment === "delivery" ? DELIVERY_TEXT[status] : undefined) ?? TEXT[status];

/** Which progress step the order is on, or null when it left the normal path (cancelled, refunded). */
export function stepIndex(status: OrderStatus, fulfilment = "pickup"): number | null {
  const steps = stepsFor(fulfilment);
  if (status === "completed") return steps.length - 1;
  const i = steps.findIndex((s) => s.status === status);
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

const RIDER: Record<string, string> = {
  queued: "We are booking your rider.",
  pending: "A rider has been booked.",
  awaiting_pickup: "Your rider is heading to the restaurant.",
  in_transit: "Your rider has your order and is on the way.",
  delivered: "Your rider has delivered your order.",
};

/** One line on where the rider is, from the delivery's status. Null when there is nothing useful to add. */
export const describeRider = (deliveryStatus: string | null | undefined): string | null => (deliveryStatus ? (RIDER[deliveryStatus] ?? null) : null);

const STAFF_DELIVERY: Record<string, string> = {
  queued: "Waiting to be booked",
  pending: "Rider booked",
  awaiting_pickup: "Rider on the way to the restaurant",
  in_transit: "Out for delivery",
  delivered: "Delivered",
  cancelled: "Cancelled with the provider",
  failed: "Booking failed",
  unknown: "Status unclear",
};

/** A delivery's status on staff screens. A status we have no word for is said to be unclear, never guessed. */
export const staffDeliveryLabel = (deliveryStatus: string): string => STAFF_DELIVERY[deliveryStatus] ?? "Status unclear";
