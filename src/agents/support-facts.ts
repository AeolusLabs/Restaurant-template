import { sql } from "drizzle-orm";
import type { RestaurantConfig } from "../../config/schema";
import type { Tx } from "@/db/context";
import { describeRider, describeStatus } from "@/domain/orders/presentation";
import type { OrderStatus } from "@/domain/orders/statuses";
import { formatMoney } from "@/lib/money";

// The only things the WhatsApp support agent may know. Built from the restaurant's own data, and, when the
// sender's number belongs to exactly one customer, that one customer's latest order. Nothing about anyone else
// is ever put in, so the model cannot repeat it however it is asked.

const DAYS = [
  ["mon", "Monday"],
  ["tue", "Tuesday"],
  ["wed", "Wednesday"],
  ["thu", "Thursday"],
  ["fri", "Friday"],
  ["sat", "Saturday"],
  ["sun", "Sunday"],
] as const;

/** The last ten digits of a phone number, which is how numbers written differently are recognised as the same. */
const last10 = (phone: string): string | null => {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
};

export async function buildFacts(tx: Tx, config: RestaurantConfig, from: string, notes: string, now: Date): Promise<{ text: string; matched: boolean }> {
  const fmt = { currency: config.currency.code, exponent: config.currency.exponent, locale: config.locale };
  const money = (minor: number) => formatMoney(minor, fmt);
  const lines: string[] = [];

  const address = [config.address.line1, config.address.area, config.address.city].filter(Boolean).join(", ");
  lines.push(`Restaurant: ${config.name}. Address: ${address}.${config.contact.phone ? ` Phone: ${config.contact.phone}.` : ""}`);
  lines.push(`Opening hours (${config.timezone} time):`);
  for (const [key, name] of DAYS) {
    const windows = config.openingHours[key];
    lines.push(`  ${name}: ${windows.length === 0 ? "closed" : windows.map((w) => `${w.open} to ${w.close}`).join(", ")}`);
  }
  lines.push(config.features.pickup ? "Pickup: available. The customer chooses a time at checkout." : "Pickup: not available.");
  lines.push(
    config.features.delivery
      ? `Delivery: available to ${config.delivery.zones.map((z) => `${z.name} (${money(z.feeMinor)})`).join(", ")}. Delivery is for now, while the restaurant is open.`
      : "Delivery: not available.",
  );

  const menu = (await tx.execute(sql`select name, price_minor, available from menu_items where active order by name limit 80`)).rows;
  lines.push("Menu:");
  for (const m of menu) lines.push(`  ${m.name as string}: ${money(Number(m.price_minor))}${m.available ? "" : " (sold out today)"}`);
  if (menu.length === 0) lines.push("  (the menu is empty)");
  if (notes.trim()) lines.push(`Notes from the restaurant: ${notes.trim()}`);

  // The sender, recognised only by an unambiguous match on their phone number.
  const key = last10(from);
  let matched = false;
  if (key) {
    const people = (
      await tx.execute(sql`
        select p.id, p.full_name from profiles p
        where p.role = 'customer' and p.deleted_at is null
          and (right(regexp_replace(coalesce(p.phone, ''), '[^0-9]', '', 'g'), 10) = ${key}
            or exists (select 1 from order_contacts oc join orders o on o.id = oc.order_id where o.profile_id = p.id and right(regexp_replace(oc.phone, '[^0-9]', '', 'g'), 10) = ${key}))
        limit 2`)
    ).rows;
    if (people.length === 1) {
      matched = true;
      const first = String(people[0].full_name).trim().split(/\s+/)[0];
      const order = (
        await tx.execute(sql`
          select o.public_code, o.status, o.fulfilment, o.total_minor, o.placed_at,
            (select d.status from deliveries d where d.order_id = o.id) as delivery_status
          from orders o where o.profile_id = ${people[0].id as string}::uuid order by o.placed_at desc limit 1`)
      ).rows[0];
      lines.push(`The person writing is a customer called ${first}.`);
      if (order) {
        const status = describeStatus(order.status as OrderStatus, order.fulfilment as string);
        const rider = order.fulfilment === "delivery" ? describeRider(order.delivery_status as string | null) : null;
        const ago = Math.max(0, Math.round((now.getTime() - new Date(order.placed_at as string).getTime()) / 60_000));
        lines.push(`Their latest order: code ${order.public_code}, ${order.fulfilment === "delivery" ? "delivery" : "pickup"}, ${money(Number(order.total_minor))}, placed ${ago} minutes ago. Status: ${status.headline}. ${status.detail}${rider ? ` ${rider}` : ""}`);
      } else {
        lines.push("They have not placed an order yet.");
      }
    }
  }
  if (!matched) lines.push("The sender is not recognised as a customer, so you cannot see any order for them. Do not discuss any order.");
  return { text: lines.join("\n"), matched };
}
