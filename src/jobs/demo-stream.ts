import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { restaurantConfig } from "../../config/restaurant";
import type { RestaurantConfig } from "../../config/schema";
import { withSystemContext, type RequestContext } from "@/db/context";
import { loadMenu } from "@/db/menu";
import { OrderRejectedError, createDeliveryOrder, createPickupOrder, type OrderRow } from "@/db/orders";
import { profiles, user } from "@/db/schema";
import { staffTransitionOrder } from "@/db/staff-actions";
import { transitionOrder } from "@/db/transition-order";
import { pickLines } from "@/domain/demo/cart";
import { DEMO_DOMAIN, DEMO_KITCHEN_EMAIL, DEMO_PROMO } from "@/domain/demo/constants";
import { openStatus } from "@/domain/hours";
import type { OrderStatus } from "@/domain/orders/statuses";
import { ConcurrentTransitionError, IllegalTransitionError, OrderNotFoundError } from "@/domain/orders/transitions";
import { pickupSlots } from "@/domain/pickup/slots";
import { loadEnv } from "@/lib/env";
import { handlePaymentWebhook } from "@/payments/webhook";
import { startPayment } from "@/payments/start-payment";
import { providers } from "@/providers";
import type { DeliveryProvider } from "@/providers/delivery/types";
import { completeMockPayment } from "@/providers/payment/mock-checkout";
import type { PaymentProvider } from "@/providers/payment/types";

// The simulated live order stream for a showcase deployment (CLAUDE.md rule 11). Each tick may place an order as a
// fictional customer and pay it, and moves each fictional order on one step. It goes through the same code a real
// customer and a real kitchen use (placing, the payment webhook, the state machine, the delivery jobs), never around
// it, and only ever touches orders made by fictional customers. See docs/superpowers/plans/2026-11-18-phase-9-demo-and-agents.md.

export type DemoStreamDeps = {
  config?: RestaurantConfig;
  now?: Date;
  /** Returns [0, 1). Replaceable so a test decides what happens. */
  rng?: () => number;
  payment?: PaymentProvider;
  delivery?: DeliveryProvider;
  /** The app's database URLs, and the site's own address for the payment callback. All default to the environment. */
  appUrl?: string;
  systemUrl?: string;
  baseUrl?: string;
  /** Chance per tick that a customer places an order. */
  placeChance?: number;
  /** Chance per tick that each order in progress moves one step. */
  advanceChance?: number;
  /** Chance that a customer who has placed an order never pays it. */
  abandonChance?: number;
  /** Chance that an order is for delivery, when delivery is on. */
  deliveryShare?: number;
  /** No new order while this many are in progress. */
  maxLive?: number;
};
export type DemoStreamResult = { placed: number; advanced: number; riders: number; skipped?: "demo_mode_off" | "closed" | "busy" | "no_customers" | "no_menu" | "rejected" };

/** What the mock rider offers beyond the DeliveryProvider interface: a way to move a delivery one step. */
type Advanceable = { advance?: (providerRef: string) => unknown };
const NEXT: Partial<Record<OrderStatus, OrderStatus>> = { paid: "accepted", accepted: "preparing", preparing: "ready", ready: "picked_up", picked_up: "completed" };
const demoEmail = `%@${DEMO_DOMAIN}`;

/** The fictional kitchen account, made on first use. Its steps are logged like any staff member's. */
async function kitchenActor(sys: { url?: string }): Promise<RequestContext> {
  const id = await withSystemContext(async (tx) => {
    const made = await tx.insert(user).values({ name: "Demo Kitchen", email: DEMO_KITCHEN_EMAIL, emailVerified: true }).onConflictDoNothing().returning({ id: user.id });
    const found = made[0]?.id ?? ((await tx.execute(sql`select id from "user" where email = ${DEMO_KITCHEN_EMAIL}`)).rows[0].id as string);
    await tx.insert(profiles).values({ id: found, role: "kitchen", fullName: "Demo Kitchen" }).onConflictDoNothing();
    return found;
  }, sys);
  return { userId: id, role: "kitchen" };
}

/** Moves each fictional order in the kitchen one step, the way a person tapping the kitchen screen would. */
async function advanceOrders(deps: Required<Pick<DemoStreamDeps, "advanceChance">> & DemoStreamDeps, rng: () => number, sys: { url?: string }): Promise<number> {
  const live = await withSystemContext(
    async (tx) =>
      (
        await tx.execute(sql`
          select o.id, o.public_code, o.status, o.fulfilment from orders o join "user" u on u.id = o.profile_id
          where u.email like ${demoEmail} and o.status in ('paid', 'accepted', 'preparing', 'ready', 'picked_up')
          order by o.updated_at, o.id limit 50`)
      ).rows,
    sys,
  );
  let kitchen: RequestContext | undefined;
  let moved = 0;
  for (const o of live) {
    if (rng() >= deps.advanceChance) continue;
    const from = o.status as OrderStatus;
    const to = NEXT[from];
    // A delivery leaves the kitchen when the rider collects it, which the delivery jobs record.
    if (!to || (o.fulfilment === "delivery" && (from === "ready" || from === "picked_up"))) continue;
    try {
      if (to === "completed") await transitionOrder({ orderId: o.id as string, to, actor: { type: "system" }, expectedFrom: from }, { systemUrl: deps.systemUrl });
      else await staffTransitionOrder((kitchen ??= await kitchenActor(sys)), o.public_code as string, to, { expectedFrom: from }, { appUrl: deps.appUrl });
      moved++;
    } catch (err) {
      // Someone (a visitor trying the kitchen screen, say) got there first. That is fine; the next tick looks again.
      if (!(err instanceof ConcurrentTransitionError || err instanceof IllegalTransitionError || err instanceof OrderNotFoundError)) throw err;
    }
  }
  return moved;
}

/** Moves each fictional delivery along with the mock rider. The delivery jobs then record it, as they would a real rider's. */
async function advanceRiders(delivery: DeliveryProvider, advanceChance: number, rng: () => number, sys: { url?: string }): Promise<number> {
  const mock = delivery as Advanceable;
  if (typeof mock.advance !== "function") return 0;
  const rows = await withSystemContext(
    async (tx) =>
      (
        await tx.execute(sql`
          select d.provider_ref, o.status as order_status from deliveries d join orders o on o.id = d.order_id join "user" u on u.id = o.profile_id
          where u.email like ${demoEmail} and d.provider_ref is not null and d.status in ('pending', 'awaiting_pickup', 'in_transit')
          order by d.updated_at limit 50`)
      ).rows,
    sys,
  );
  let moved = 0;
  for (const r of rows) {
    if (rng() >= advanceChance) continue;
    const ref = r.provider_ref as string;
    const at = (await delivery.getDelivery(ref)).status;
    const ready = r.order_status === "ready" || r.order_status === "out_for_delivery";
    // A rider is found at once, collects once the food is ready, and delivers once it is on the road.
    if (at === "pending" || (at === "awaiting_pickup" && ready) || (at === "in_transit" && r.order_status === "out_for_delivery")) {
      mock.advance(ref);
      moved++;
    }
  }
  return moved;
}

/** One tick of the stream. */
export async function runDemoStream(deps: DemoStreamDeps = {}): Promise<DemoStreamResult> {
  const cfg = deps.config ?? restaurantConfig;
  const result: DemoStreamResult = { placed: 0, advanced: 0, riders: 0 };
  if (!cfg.features.demo_mode) return { ...result, skipped: "demo_mode_off" };
  const payment = deps.payment ?? providers().payment;
  const delivery = deps.delivery ?? providers().delivery;
  if (payment.name !== "mock" || delivery.name !== "mock") {
    throw new Error(`The demo stream will not run against a real provider (payment: ${payment.name}, delivery: ${delivery.name}): fictional orders must never reach real money or people.`);
  }
  const rng = deps.rng ?? Math.random;
  const now = deps.now ?? new Date();
  const sys = { url: deps.systemUrl };

  result.advanced = await advanceOrders({ ...deps, advanceChance: deps.advanceChance ?? 0.5 }, rng, sys);
  result.riders = await advanceRiders(delivery, deps.advanceChance ?? 0.5, rng, sys);

  if (rng() >= (deps.placeChance ?? 0.45)) return result;
  // A real customer cannot order while the restaurant is closed, so neither does the stream. The seeded history fills the quiet hours.
  if (!openStatus(now, cfg).open) return { ...result, skipped: "closed" };

  const { customers, live } = await withSystemContext(async (tx) => {
    const customers = (
      await tx.execute(sql`
        select p.id, p.phone, u.email from profiles p join "user" u on u.id = p.id
        where u.email like ${demoEmail} and p.role = 'customer' and p.blocked_at is null and p.deleted_at is null order by p.created_at, p.id`)
    ).rows;
    const live = Number(
      (
        await tx.execute(sql`
          select count(*) as n from orders o join "user" u on u.id = o.profile_id
          where u.email like ${demoEmail} and o.status in ('placed', 'paid', 'accepted', 'preparing', 'ready', 'out_for_delivery', 'picked_up')`)
      ).rows[0].n,
    );
    return { customers, live };
  }, sys);
  if (live >= (deps.maxLive ?? 10)) return { ...result, skipped: "busy" };
  if (customers.length === 0) return { ...result, skipped: "no_customers" };

  const menu = (await loadMenu({ url: deps.appUrl })).flatMap((c) => c.items).filter((i) => i.active && i.available);
  if (menu.length === 0) return { ...result, skipped: "no_menu" };

  const customer = customers[Math.floor(rng() * customers.length)];
  const ctx: RequestContext = { userId: customer.id as string, role: "customer" };
  const lines = pickLines(menu, rng);
  const phone = (customer.phone as string | null) ?? "+234 800 000 0000";
  const checkoutToken = `demo-${randomUUID()}`;
  const placing = { now, config: cfg, appUrl: deps.appUrl };
  const byDelivery = cfg.features.delivery && cfg.delivery.zones.length > 0 && rng() < (deps.deliveryShare ?? 0.3);
  const slots = pickupSlots(now, cfg);
  const slot = slots[Math.floor(rng() * Math.min(4, slots.length))];
  const zone = cfg.delivery.zones[Math.floor(rng() * Math.max(1, cfg.delivery.zones.length))];
  const address = `${1 + Math.floor(rng() * 80)} Demo Street, ${cfg.address.area ?? cfg.address.city}`;
  const promoCode = cfg.features.promos && rng() < 0.15 ? DEMO_PROMO : undefined;

  const place = (code?: string): Promise<{ order: OrderRow }> =>
    byDelivery ? createDeliveryOrder(ctx, { lines, zone: zone.name, address, phone, checkoutToken, promoCode: code }, placing) : createPickupOrder(ctx, { lines, pickupAt: slot, phone, checkoutToken, promoCode: code }, placing);
  let order: OrderRow;
  try {
    order = (await place(promoCode).catch((err) => (err instanceof OrderRejectedError && err.code === "promo_invalid" ? place(undefined) : Promise.reject(err)))).order;
  } catch (err) {
    // The menu or the hours changed between looking and ordering. A customer would see a message; the stream just tries again next tick.
    if (err instanceof OrderRejectedError) return { ...result, skipped: "rejected" };
    throw err;
  }
  result.placed = 1;
  if (rng() < (deps.abandonChance ?? 0.1)) return result;

  const { reference } = await startPayment(ctx, order.publicCode, { email: customer.email as string, provider: payment, baseUrl: deps.baseUrl ?? loadEnv().APP_URL, now, appUrl: deps.appUrl, systemUrl: deps.systemUrl });
  await completeMockPayment(payment, { reference, result: "success" }, (body, headers) => handlePaymentWebhook(body, headers, { provider: payment, systemUrl: deps.systemUrl }));
  return result;
}
