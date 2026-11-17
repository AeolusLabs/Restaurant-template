export const ORDER_STATUSES = [
  "placed",
  "paid",
  "accepted",
  "preparing",
  "ready",
  "out_for_delivery",
  "picked_up",
  "completed",
  "cancelled",
  "refunded",
  "delivery_failed",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const FULFILMENTS = ["pickup", "delivery"] as const;
export type Fulfilment = (typeof FULFILMENTS)[number];

export const CONSENT_TYPES = ["terms", "privacy", "marketing"] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

export const ACTOR_TYPES = ["customer", "staff", "system"] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];
