import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { restaurantConfig } from "../../config/restaurant";
import type { RestaurantConfig } from "../../config/schema";
import { loadPricingItems } from "@/db/menu";
import { consents, orderContacts, orderEvents, orderItems, orders, payments, profiles, promoRedemptions, promos, qrScans, qrSources, refunds, user } from "@/db/schema";
import { generatePublicCode } from "@/domain/orders/public-code";
import type { OrderStatus } from "@/domain/orders/statuses";
import { priceCart, type CartLine } from "@/domain/pricing/price-cart";
import type { PromoTerms } from "@/domain/promos/rules";
import { localDay, toMinutes, zonedToUtc } from "@/domain/time";
import { seededRng } from "@/lib/rng";

// Fictional data for a showcase deployment (CLAUDE.md rule 11). Everything it makes is marked by an address nobody can
// receive mail at, so it can be found and removed. It needs the privileged connection because it back-dates orders,
// which the app's own roles cannot do. See docs/superpowers/plans/2026-11-18-phase-9-demo-and-agents.md.

export class DemoSeedError extends Error {}

export const DEMO_DOMAIN = "demo.invalid";
/** The seeded promo and QR code. The slug uses the letters a QR slug allows. */
export const DEMO_PROMO = "DEMO10";
const DEMO_QR_SLUG = "kd2mq9xv";
const DEMO_QR_LABEL = "Demo table card";
const PROMO_TERMS: PromoTerms = { kind: "percent", value: 1000, minOrderMinor: 0, maxDiscountMinor: 200_000 };

export type DemoSeedOptions = { adminUrl: string; config?: RestaurantConfig; now?: Date; rng?: () => number; days?: number };
export type DemoSeedResult = { customers: number; orders: number; paid: number; cancelled: number; refunded: number; removedOrders: number };

const FIRST = ["Ada", "Tunde", "Ngozi", "Emeka", "Fatima", "Segun", "Chioma", "Ibrahim", "Bisi", "Kelechi", "Amaka", "Yusuf"];
const LAST = ["Okafor", "Bello", "Adeyemi", "Eze", "Musa", "Balogun", "Nwosu", "Abubakar", "Ogunleye", "Obi", "Danjuma", "Fashola"];
const two = (n: number) => String(n).padStart(2, "0");
const MIN = 60_000;

/** Removes everything a previous run made, in the order the foreign keys allow. */
async function removeDemo(tx: Parameters<Parameters<ReturnType<typeof drizzle>["transaction"]>[0]>[0]): Promise<number> {
  const mine = sql`(select o.id from orders o join "user" u on u.id = o.profile_id where u.email like ${`%@${DEMO_DOMAIN}`})`;
  const count = Number((await tx.execute(sql`select count(*) as n from orders where id in ${mine}`)).rows[0].n);
  await tx.execute(sql`delete from refunds where payment_id in (select id from payments where order_id in ${mine})`);
  await tx.execute(sql`delete from payments where order_id in ${mine}`);
  await tx.execute(sql`delete from order_events where order_id in ${mine}`);
  await tx.execute(sql`delete from deliveries where order_id in ${mine}`);
  await tx.execute(sql`delete from promo_redemptions where order_id in ${mine}`);
  await tx.execute(sql`delete from orders where id in ${mine}`);
  await tx.execute(sql`delete from qr_scans where source_id in (select id from qr_sources where slug = ${DEMO_QR_SLUG})`);
  await tx.execute(sql`delete from qr_sources where slug = ${DEMO_QR_SLUG}`);
  await tx.execute(sql`delete from promos where code = ${DEMO_PROMO}`);
  await tx.execute(sql`delete from "user" where email like ${`%@${DEMO_DOMAIN}`}`);
  return count;
}

/** Fills the database with two weeks of fictional history. Idempotent: it removes its own earlier data first. */
export async function seedDemo(opts: DemoSeedOptions): Promise<DemoSeedResult> {
  const cfg = opts.config ?? restaurantConfig;
  const now = opts.now ?? new Date();
  const rng = opts.rng ?? seededRng(20_261_118);
  const days = opts.days ?? 14;
  if (!cfg.features.demo_mode) throw new DemoSeedError("Demo mode is off. Set features.demo_mode to true in config/restaurant.ts first; seed:demo only runs for a showcase deployment.");

  const pool = new Pool({ connectionString: opts.adminUrl, max: 2 });
  try {
    return await drizzle(pool).transaction(async (tx) => {
      const real = Number(
        (await tx.execute(sql`select count(*) as n from orders o where not exists (select 1 from "user" u where u.id = o.profile_id and u.email like ${`%@${DEMO_DOMAIN}`})`)).rows[0].n,
      );
      if (real > 0) throw new DemoSeedError(`This database holds ${real} real orders, so the demo data will not be added. seed:demo is for a database that only ever holds fictional orders.`);

      const removedOrders = await removeDemo(tx);

      const menuIds = (await tx.execute(sql`select id from menu_items where active and available`)).rows.map((r) => r.id as string);
      const menu = (await loadPricingItems(tx, menuIds)).filter((i) => i.active && i.available);
      if (menu.length === 0) throw new DemoSeedError("The menu has no items to order. Run pnpm db:seed first.");

      const [promo] = await tx.insert(promos).values({ code: DEMO_PROMO, description: "Demo: 10% off, up to the first 2,000", kind: "percent", value: 1000, maxDiscountMinor: 200_000 }).returning({ id: promos.id });
      const [source] = await tx.insert(qrSources).values({ slug: DEMO_QR_SLUG, label: DEMO_QR_LABEL }).returning({ id: qrSources.id });

      const customers: { id: string; name: string; phone: string }[] = [];
      for (let i = 0; i < FIRST.length; i++) {
        const name = `${FIRST[i]} ${LAST[(i * 5 + 3) % LAST.length]}`;
        const phone = `+234 800 000 00${two(i + 1)}`;
        const joined = new Date(now.getTime() - (days + 20) * 86_400_000);
        const [u] = await tx.insert(user).values({ name, email: `demo.${i + 1}@${DEMO_DOMAIN}`, emailVerified: true, createdAt: joined, updatedAt: joined }).returning({ id: user.id });
        await tx.insert(profiles).values({ id: u.id, role: "customer", fullName: name, phone, createdAt: joined });
        await tx.insert(consents).values([
          { profileId: u.id, type: "terms", policyVersion: cfg.legal.policyVersion, grantedAt: joined },
          { profileId: u.id, type: "privacy", policyVersion: cfg.legal.policyVersion, grantedAt: joined },
          ...(i % 2 === 0 ? [{ profileId: u.id, type: "marketing" as const, policyVersion: cfg.legal.policyVersion, grantedAt: joined }] : []),
        ]);
        customers.push({ id: u.id, name, phone });
      }

      // When orders were placed: lunch and dinner are busier, Friday and Saturday more so, and only while open.
      const tz = cfg.timezone;
      const placedTimes: number[] = [];
      for (let back = days; back >= 0; back--) {
        const day = localDay(now.getTime(), tz, -back);
        const windows = cfg.openingHours[day.weekday];
        if (windows.length === 0) continue;
        const count = 5 + (day.weekday === "fri" || day.weekday === "sat" ? 4 : 0) + Math.floor(rng() * 4);
        for (let k = 0; k < count; k++) {
          const w = windows[Math.floor(rng() * windows.length)];
          const open = toMinutes(w.open);
          const last = toMinutes(w.close) - 60;
          const centre = rng() < 0.5 ? 13 * 60 : 19 * 60;
          const minute = Math.min(last, Math.max(open, Math.round(centre + (rng() + rng() - 1) * 120)));
          const at = zonedToUtc(day.y, day.m, day.d, Math.floor(minute / 60), minute % 60, tz);
          if (at <= now.getTime() - 90 * MIN) placedTimes.push(at);
        }
      }
      placedTimes.sort((a, b) => a - b);

      const used = new Set<string>();
      let paid = 0;
      let cancelled = 0;
      let refunded = 0;
      for (const [i, placedMs] of placedTimes.entries()) {
        const final: OrderStatus = i % 12 === 5 ? "cancelled" : i % 25 === 7 ? "refunded" : "completed";
        const customer = customers[Math.floor(rng() ** 1.6 * customers.length)];

        const lines: CartLine[] = [];
        const picked = new Set<string>();
        for (let l = 0, want = 1 + Math.floor(rng() * 3); l < want; l++) {
          const item = menu[Math.floor(rng() * menu.length)];
          if (picked.has(item.id)) continue;
          picked.add(item.id);
          const modifierIds: string[] = [];
          for (const g of item.groups) {
            const options = g.modifiers.filter((m) => m.available);
            const need = Math.max(g.minSelect, rng() < 0.3 ? 1 : 0);
            for (const m of options.slice(0, Math.min(need, g.maxSelect))) modifierIds.push(m.id);
          }
          lines.push({ itemId: item.id, quantity: rng() < 0.25 ? 2 : 1, modifierIds });
        }
        const useCode = final !== "cancelled" && rng() < 0.15;
        let priced = priceCart(lines, menu, cfg.charges, 0, useCode ? PROMO_TERMS : undefined);
        if (!priced.ok) priced = priceCart(lines, menu, cfg.charges, 0);
        if (!priced.ok) throw new DemoSeedError(`A demo order could not be priced: ${JSON.stringify(priced.problems)}`);
        const withCode = useCode && priced.discountMinor > 0;

        let code = generatePublicCode((max) => Math.floor(rng() * max));
        while (used.has(code)) code = generatePublicCode((max) => Math.floor(rng() * max));
        used.add(code);

        const at = (minutes: number) => new Date(placedMs + minutes * MIN);
        const scanned = rng() < 0.25;
        const lastAt = final === "cancelled" ? at(cfg.orders.unpaidExpiryMinutes) : final === "refunded" ? at(75) : at(48);
        const [order] = await tx
          .insert(orders)
          .values({
            publicCode: code,
            profileId: customer.id,
            checkoutToken: `demo-${i}`,
            customerName: customer.name,
            status: final,
            fulfilment: "pickup",
            pickupAt: at(35),
            subtotalMinor: priced.subtotalMinor,
            discountMinor: priced.discountMinor,
            serviceChargeMinor: priced.serviceChargeMinor,
            taxMinor: priced.taxMinor,
            deliveryFeeMinor: priced.deliveryFeeMinor,
            totalMinor: priced.totalMinor,
            currency: cfg.currency.code,
            promoId: withCode ? promo.id : null,
            promoCode: withCode ? DEMO_PROMO : null,
            sourceId: scanned ? source.id : null,
            expiresAt: at(cfg.orders.unpaidExpiryMinutes),
            placedAt: at(0),
            updatedAt: lastAt,
          })
          .returning({ id: orders.id });
        await tx.insert(orderItems).values(priced.lines.map((l) => ({ orderId: order.id, itemId: l.itemId, nameSnapshot: l.name, unitPriceMinorSnapshot: l.unitPriceMinor, quantity: l.quantity, modifiersSnapshot: l.modifiers, lineTotalMinor: l.lineTotalMinor })));
        await tx.insert(orderContacts).values({ orderId: order.id, phone: customer.phone });
        if (withCode) await tx.insert(promoRedemptions).values({ promoId: promo.id, orderId: order.id, profileId: customer.id, discountMinor: priced.discountMinor, createdAt: at(0) });
        if (scanned) await tx.insert(qrScans).values({ sourceId: source.id, scannedAt: at(-3) });

        const step = (from: OrderStatus | null, to: OrderStatus, minutes: number, actor: "customer" | "staff" | "system", reason?: string) =>
          ({ orderId: order.id, fromStatus: from, toStatus: to, actorType: actor, actorId: actor === "customer" ? customer.id : null, reason: reason ?? null, createdAt: at(minutes) });
        if (final === "cancelled") {
          cancelled++;
          await tx.insert(orderEvents).values([step(null, "placed", 0, "customer"), step("placed", "cancelled", cfg.orders.unpaidExpiryMinutes, "system", "Not paid in time")]);
          continue;
        }
        paid++;
        const [payment] = await tx
          .insert(payments)
          .values({ orderId: order.id, provider: "mock", reference: `demo_${code}`, amountMinor: priced.totalMinor, currency: cfg.currency.code, status: final === "refunded" ? "refunded" : "succeeded", paidAt: at(2), createdAt: at(1) })
          .returning({ id: payments.id });
        const events = [step(null, "placed", 0, "customer"), step("placed", "paid", 2, "system"), step("paid", "accepted", 4, "staff"), step("accepted", "preparing", 6, "staff"), step("preparing", "ready", 20, "staff"), step("ready", "picked_up", 38, "staff"), step("picked_up", "completed", 48, "system")];
        if (final === "refunded") {
          refunded++;
          events.push(step("completed", "refunded", 75, "staff", "Customer was unhappy with the order"));
          await tx.insert(refunds).values({ paymentId: payment.id, amountMinor: priced.totalMinor, reason: "Customer was unhappy with the order", status: "succeeded", providerRef: `demo_refund_${code}`, createdAt: at(75) });
        }
        await tx.insert(orderEvents).values(events);
      }

      // A few visits that did not turn into an order, so the scan counts are not all conversions.
      for (let s = 0; s < 18; s++) await tx.insert(qrScans).values({ sourceId: source.id, scannedAt: new Date(now.getTime() - Math.floor(rng() * days * 86_400_000)) });

      return { customers: customers.length, orders: placedTimes.length, paid, cancelled, refunded, removedOrders };
    });
  } finally {
    await pool.end();
  }
}
