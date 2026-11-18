import { and, desc, eq } from "drizzle-orm";
import { restaurantConfig } from "../../config/restaurant";
import type { RestaurantConfig } from "../../config/schema";
import { createOrderSchema, deliveryOrderSchema, type CreateDeliveryOrderInput, type CreateOrderInput } from "@/domain/checkout/order-input";
import { openStatus } from "@/domain/hours";
import type { CartInput } from "@/domain/checkout/cart";
import { generatePublicCode } from "@/domain/orders/public-code";
import type { PromoProblem } from "@/domain/promos/rules";
import type { OrderStatus } from "@/domain/orders/statuses";
import { IllegalTransitionError, OrderNotFoundError } from "@/domain/orders/transitions";
import { isValidPickupSlot } from "@/domain/pickup/slots";
import { priceCart, type LineProblem } from "@/domain/pricing/price-cart";
import { toPublicDelivery, toPublicDropoff, type PublicDelivery, type PublicDropoff, type PublicOrderItem } from "@/lib/sanitize";
import { withRequestContext, type ContextOptions, type RequestContext, type Tx } from "./context";
import { loadPricingItems } from "./menu";
import { lookupPromoForOrder } from "./promos";
import { deliveries, orderContacts, orderItems, orders, profiles, promoRedemptions } from "./schema";
import { transitionOrder } from "./transition-order";

export type RejectionCode =
  | "not_a_customer"
  | "pickup_disabled"
  | "delivery_disabled"
  | "closed"
  | "invalid_zone"
  | "invalid_slot"
  | "cart_problems"
  | "price_changed"
  | "promo_invalid"
  | "profile_missing";

/** The order cannot be placed as asked. `problems` names the cart lines at fault, for cart_problems. */
export class OrderRejectedError extends Error {
  constructor(
    readonly code: RejectionCode,
    message: string,
    readonly problems: LineProblem[] = [],
    /** For promo_invalid: why the code cannot be used, in the vocabulary of promoText(). */
    readonly promoReason?: PromoProblem,
  ) {
    super(message);
  }
}

export type OrderRow = typeof orders.$inferSelect;
export type OrderView = { order: OrderRow; items: PublicOrderItem[]; delivery: PublicDelivery | null; dropoff: PublicDropoff | null };

export type CreateOrderDeps = {
  now?: Date;
  config?: RestaurantConfig;
  appUrl?: string;
  /** Replaceable so a test can force a code collision. */
  code?: () => string;
};

const MAX_CODE_ATTEMPTS = 5;

const findByToken = async (tx: Tx, profileId: string, token: string): Promise<OrderRow | undefined> =>
  (await tx.select().from(orders).where(and(eq(orders.profileId, profileId), eq(orders.checkoutToken, token))).limit(1))[0];

type Common = { lines: CartInput; phone: string; notes?: string; promoCode?: string; expectedTotalMinor?: number; checkoutToken: string };
type Mode =
  | { fulfilment: "pickup"; pickupAt: Date }
  | { fulfilment: "delivery"; deliveryFeeMinor: number; address: { zone: string; address: string; landmark?: string } };

/**
 * Places an order for the signed-in customer, in one transaction: prices the cart from the database and config
 * (the browser sends no prices), and writes the order, its line snapshots and the contact details. The order
 * starts as `placed` and unpaid; paying it is a separate step. A second call with the same checkoutToken
 * returns the first order instead of making another.
 */
async function placeOrder(
  ctx: RequestContext,
  input: Common,
  mode: Mode,
  cfg: RestaurantConfig,
  now: Date,
  deps: CreateOrderDeps,
): Promise<{ order: OrderRow; created: boolean }> {
  return withRequestContext(
    ctx,
    async (tx) => {
      const existing = await findByToken(tx, ctx.userId, input.checkoutToken);
      if (existing) return { order: existing, created: false };

      const [profile] = await tx.select({ fullName: profiles.fullName }).from(profiles).where(eq(profiles.id, ctx.userId));
      if (!profile) throw new OrderRejectedError("profile_missing", "Your account has no profile");

      const items = await loadPricingItems(tx, [...new Set(input.lines.map((l) => l.itemId))]);
      let promo: Awaited<ReturnType<typeof lookupPromoForOrder>> | undefined;
      if (input.promoCode) {
        promo = await lookupPromoForOrder(tx, ctx.userId, input.promoCode, mode.fulfilment, cfg, now);
        if (!promo.ok) throw new OrderRejectedError("promo_invalid", "That promo code cannot be used", [], promo.reason);
      }
      const priced = priceCart(input.lines, items, cfg.charges, mode.fulfilment === "delivery" ? mode.deliveryFeeMinor : 0, promo?.ok ? promo.promo : undefined);
      if (!priced.ok) {
        // A promo problem sits on the cart as a whole (index -1); everything else is about a line.
        const forPromo = priced.problems.find((p) => p.code === "promo_below_minimum" || p.code === "promo_free_order");
        if (forPromo) throw new OrderRejectedError("promo_invalid", "That promo code cannot be used on this order", [], forPromo.code === "promo_below_minimum" ? "below_minimum" : "free_order");
        throw new OrderRejectedError("cart_problems", "Some items in your cart cannot be ordered", priced.problems);
      }

      if (input.expectedTotalMinor !== undefined && input.expectedTotalMinor !== priced.totalMinor) {
        throw new OrderRejectedError("price_changed", "The prices changed while you were checking out. Please review your order");
      }

      let order: OrderRow | undefined;
      for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS && !order; attempt++) {
        const [row] = await tx
          .insert(orders)
          .values({
            publicCode: (deps.code ?? generatePublicCode)(),
            profileId: ctx.userId,
            checkoutToken: input.checkoutToken,
            customerName: profile.fullName,
            status: "placed",
            fulfilment: mode.fulfilment,
            pickupAt: mode.fulfilment === "pickup" ? mode.pickupAt : null,
            subtotalMinor: priced.subtotalMinor,
            serviceChargeMinor: priced.serviceChargeMinor,
            taxMinor: priced.taxMinor,
            discountMinor: priced.discountMinor,
            promoId: promo?.ok ? promo.promo.id : null,
            promoCode: promo?.ok ? promo.promo.code : null,
            deliveryFeeMinor: priced.deliveryFeeMinor,
            totalMinor: priced.totalMinor,
            currency: cfg.currency.code,
            notes: input.notes ?? null,
            expiresAt: new Date(now.getTime() + cfg.orders.unpaidExpiryMinutes * 60_000),
          })
          // A conflict is either a repeat of this checkout (same token) or a taken public code.
          .onConflictDoNothing()
          .returning();
        if (row) {
          order = row;
          continue;
        }
        const repeat = await findByToken(tx, ctx.userId, input.checkoutToken);
        if (repeat) return { order: repeat, created: false };
      }
      if (!order) throw new Error("Could not allocate a public order code");

      await tx.insert(orderItems).values(
        priced.lines.map((l) => ({
          orderId: order.id,
          itemId: l.itemId,
          nameSnapshot: l.name,
          unitPriceMinorSnapshot: l.unitPriceMinor,
          quantity: l.quantity,
          modifiersSnapshot: l.modifiers,
          lineTotalMinor: l.lineTotalMinor,
        })),
      );
      await tx.insert(orderContacts).values({ orderId: order.id, phone: input.phone, ...(mode.fulfilment === "delivery" ? { addressSnapshot: mode.address } : {}) });
      if (promo?.ok) {
        await tx.insert(promoRedemptions).values({ promoId: promo.promo.id, orderId: order.id, profileId: ctx.userId, discountMinor: priced.discountMinor + priced.deliveryWaivedMinor });
      }
      return { order, created: true };
    },
    { url: deps.appUrl },
  );
}

/** A pickup order: validates the pickup slot, then places it. */
export async function createPickupOrder(
  ctx: RequestContext,
  rawInput: CreateOrderInput,
  deps: CreateOrderDeps = {},
): Promise<{ order: OrderRow; created: boolean }> {
  const input = createOrderSchema.parse(rawInput);
  const cfg = deps.config ?? restaurantConfig;
  const now = deps.now ?? new Date();
  if (ctx.role !== "customer") throw new OrderRejectedError("not_a_customer", "Only customer accounts can place orders");
  if (!cfg.features.pickup) throw new OrderRejectedError("pickup_disabled", "Pickup orders are not available");
  if (!isValidPickupSlot(input.pickupAt, now, cfg)) {
    throw new OrderRejectedError("invalid_slot", "That pickup time is no longer available");
  }
  return placeOrder(ctx, input, { fulfilment: "pickup", pickupAt: input.pickupAt }, cfg, now, deps);
}

/**
 * A delivery order. The customer picks a zone from config and types an address; the fee comes from the zone.
 * Delivery is for now (no slot), so it is refused while the restaurant is closed.
 */
export async function createDeliveryOrder(
  ctx: RequestContext,
  rawInput: CreateDeliveryOrderInput,
  deps: CreateOrderDeps = {},
): Promise<{ order: OrderRow; created: boolean }> {
  const input = deliveryOrderSchema.parse(rawInput);
  const cfg = deps.config ?? restaurantConfig;
  const now = deps.now ?? new Date();
  if (ctx.role !== "customer") throw new OrderRejectedError("not_a_customer", "Only customer accounts can place orders");
  if (!cfg.features.delivery) throw new OrderRejectedError("delivery_disabled", "Delivery orders are not available");
  if (!openStatus(now, cfg).open) throw new OrderRejectedError("closed", "We are closed, so we cannot take a delivery order right now");
  const zone = cfg.delivery.zones.find((z) => z.name === input.zone);
  if (!zone) throw new OrderRejectedError("invalid_zone", "We do not deliver to that area");
  return placeOrder(
    ctx,
    input,
    { fulfilment: "delivery", deliveryFeeMinor: zone.feeMinor, address: { zone: zone.name, address: input.address, ...(input.landmark ? { landmark: input.landmark } : {}) } },
    cfg,
    now,
    deps,
  );
}

async function readItems(tx: Tx, orderId: string): Promise<PublicOrderItem[]> {
  const rows = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId)).orderBy(orderItems.id);
  return rows.map((r) => ({
    name: r.nameSnapshot,
    quantity: r.quantity,
    unitPriceMinor: r.unitPriceMinorSnapshot,
    modifiers: (r.modifiersSnapshot as { name: string; priceDeltaMinor: number }[]).map((m) => ({
      name: m.name,
      priceDeltaMinor: m.priceDeltaMinor,
    })),
    lineTotalMinor: r.lineTotalMinor,
  }));
}

/** One order by its public code, if the signed-in user may see it (RLS decides), with its lines. */
export function getOrderForCustomer(ctx: RequestContext, publicCode: string, opts?: ContextOptions): Promise<OrderView | null> {
  return withRequestContext(
    ctx,
    async (tx) => {
      const [order] = await tx.select().from(orders).where(eq(orders.publicCode, publicCode)).limit(1);
      if (!order) return null;
      const items = await readItems(tx, order.id);
      if (order.fulfilment !== "delivery") return { order, items, delivery: null, dropoff: null };
      const [delivery] = await tx.select({ status: deliveries.status, trackingUrl: deliveries.trackingUrl }).from(deliveries).where(eq(deliveries.orderId, order.id));
      const [contact] = await tx.select({ addressSnapshot: orderContacts.addressSnapshot }).from(orderContacts).where(eq(orderContacts.orderId, order.id));
      return { order, items, delivery: toPublicDelivery(delivery), dropoff: toPublicDropoff(contact?.addressSnapshot) };
    },
    opts,
  );
}

/** The customer's own orders, newest first. */
export function listOrdersForCustomer(ctx: RequestContext, opts?: ContextOptions): Promise<OrderRow[]> {
  return withRequestContext(
    ctx,
    (tx) => tx.select().from(orders).where(eq(orders.profileId, ctx.userId)).orderBy(desc(orders.placedAt)).limit(50),
    opts,
  );
}

/**
 * Lets a customer abandon an order they have not paid for. A paid order cannot be cancelled here, because
 * cancelling it means refunding money, which staff do (Phase 3).
 */
export async function cancelUnpaidOrder(ctx: RequestContext, publicCode: string, opts: { appUrl?: string } = {}): Promise<void> {
  const found = await withRequestContext(
    ctx,
    async (tx) => (await tx.select({ id: orders.id, status: orders.status }).from(orders).where(eq(orders.publicCode, publicCode)).limit(1))[0],
    { url: opts.appUrl },
  );
  if (!found) throw new OrderNotFoundError("Order not found");
  if (found.status !== ("placed" satisfies OrderStatus)) {
    throw new IllegalTransitionError("Only an unpaid order can be cancelled here; paid orders are refunded by the restaurant");
  }
  await transitionOrder(
    { orderId: found.id, to: "cancelled", actor: { type: "customer", id: ctx.userId }, expectedFrom: "placed", reason: "customer cancelled" },
    { appUrl: opts.appUrl },
  );
}
