import { sql } from "drizzle-orm";
import { restaurantConfig } from "../../config/restaurant";
import { requireRole } from "@/auth/session";
import { periodFor, type DeliveryFigures, type HeatCell, type Period } from "@/domain/dashboard/rules";
import { withRequestContext, type ContextOptions, type RequestContext } from "./context";

// What the dashboard reads. Read-only, and run as the signed-in manager or owner, so row-level security still
// decides what they may see. Every figure is a count or a sum of rows; nothing is estimated.
//
// "Sales" are orders whose payment succeeded and was not refunded, counted at the time of payment (payments.paid_at)
// in the restaurant's timezone. A refunded order is counted separately and is never sales.

export type DashboardData = {
  period: Period;
  sales: { salesMinor: number; orders: number; refundedMinor: number; refundedOrders: number; prevSalesMinor: number; prevOrders: number };
  daily: { key: string; salesMinor: number; orders: number }[];
  hours: HeatCell[];
  customers: { newCustomers: number; returning: number };
  fulfilment: { pickup: { orders: number; salesMinor: number }; delivery: { orders: number; salesMinor: number } };
  delivery: DeliveryFigures & { freeDeliveries: number };
  topItems: { name: string; quantity: number; salesMinor: number }[];
  promos: { orders: number; discountMinor: number };
};

type Options = { days: 7 | 30 | 90; now?: Date; timeZone?: string };

const n = (v: unknown) => Number(v ?? 0);

export async function loadDashboard(ctx: RequestContext, options: Options, opts?: ContextOptions): Promise<DashboardData> {
  requireRole(ctx, ["owner", "manager"]);
  const tz = options.timeZone ?? restaurantConfig.timezone;
  const period = periodFor(options.now ?? new Date(), options.days, tz);
  const start = period.start.toISOString();
  const end = period.end.toISOString();
  const prevStart = period.prevStart.toISOString();
  const prevEnd = period.prevEnd.toISOString();

  // Paid orders in a window that were not refunded.
  const sold = (from: string, to: string) => sql`(
    select o.id as order_id, o.profile_id, o.fulfilment, o.total_minor, pay.paid_at
    from payments pay join orders o on o.id = pay.order_id
    where pay.status = 'succeeded' and pay.paid_at >= ${from}::timestamptz and pay.paid_at < ${to}::timestamptz
  )`;
  const current = sold(start, end);

  return withRequestContext(
    ctx,
    async (tx) => {
      const daily = (await tx.execute(sql`
        select to_char(paid_at at time zone ${tz}, 'YYYY-MM-DD') as day, count(*) as orders, coalesce(sum(total_minor), 0) as sales
        from ${current} s group by 1`)).rows;
      const prev = (await tx.execute(sql`select count(*) as orders, coalesce(sum(total_minor), 0) as sales from ${sold(prevStart, prevEnd)} s`)).rows[0];
      const refunded = (await tx.execute(sql`
        select count(*) as orders, coalesce(sum(pay.amount_minor), 0) as amount
        from payments pay where pay.status = 'refunded' and pay.paid_at >= ${start}::timestamptz and pay.paid_at < ${end}::timestamptz`)).rows[0];
      const hours = (await tx.execute(sql`
        select extract(isodow from paid_at at time zone ${tz})::int as weekday, extract(hour from paid_at at time zone ${tz})::int as hour, count(*) as orders
        from ${current} s group by 1, 2`)).rows;
      const customers = (await tx.execute(sql`
        with cur as (select distinct profile_id from ${current} s where profile_id is not null),
        first_paid as (
          select o.profile_id, min(pay.paid_at) as first_at
          from payments pay join orders o on o.id = pay.order_id
          where pay.status in ('succeeded', 'refunded', 'partially_refunded') and o.profile_id in (select profile_id from cur)
          group by 1)
        select count(*) filter (where first_at >= ${start}::timestamptz) as new_customers, count(*) filter (where first_at < ${start}::timestamptz) as returning
        from first_paid`)).rows[0];
      const fulfilment = (await tx.execute(sql`select fulfilment::text as f, count(*) as orders, coalesce(sum(total_minor), 0) as sales from ${current} s group by 1`)).rows;
      const delivery = (await tx.execute(sql`
        select count(*) as deliveries, coalesce(sum(d.fee_charged_minor), 0) as collected, coalesce(sum(d.provider_cost_minor), 0) as cost, count(*) filter (where d.fee_charged_minor = 0) as free
        from ${current} s join deliveries d on d.order_id = s.order_id
        where d.provider_cost_minor is not null and d.status not in ('queued', 'failed', 'cancelled')`)).rows[0];
      const items = (await tx.execute(sql`
        select oi.name_snapshot as name, sum(oi.quantity) as quantity, sum(oi.line_total_minor) as sales
        from ${current} s join order_items oi on oi.order_id = s.order_id
        group by oi.name_snapshot order by sum(oi.quantity) desc, sum(oi.line_total_minor) desc, oi.name_snapshot limit 5`)).rows;
      const promos = (await tx.execute(sql`
        select count(*) as orders, coalesce(sum(r.discount_minor), 0) as discount
        from ${current} s join promo_redemptions r on r.order_id = s.order_id where r.released_at is null`)).rows[0];

      const byDay = new Map(daily.map((r) => [r.day as string, r]));
      const fulfil = (kind: string) => {
        const r = fulfilment.find((x) => x.f === kind);
        return { orders: n(r?.orders), salesMinor: n(r?.sales) };
      };
      return {
        period,
        sales: {
          salesMinor: daily.reduce((sum, r) => sum + n(r.sales), 0),
          orders: daily.reduce((sum, r) => sum + n(r.orders), 0),
          refundedMinor: n(refunded?.amount),
          refundedOrders: n(refunded?.orders),
          prevSalesMinor: n(prev?.sales),
          prevOrders: n(prev?.orders),
        },
        daily: period.localDays.map((d) => ({ key: d.key, salesMinor: n(byDay.get(d.key)?.sales), orders: n(byDay.get(d.key)?.orders) })),
        hours: hours.map((r) => ({ weekday: n(r.weekday), hour: n(r.hour), orders: n(r.orders) })),
        customers: { newCustomers: n(customers?.new_customers), returning: n(customers?.returning) },
        fulfilment: { pickup: fulfil("pickup"), delivery: fulfil("delivery") },
        delivery: { deliveries: n(delivery?.deliveries), collectedMinor: n(delivery?.collected), costMinor: n(delivery?.cost), freeDeliveries: n(delivery?.free) },
        topItems: items.map((r) => ({ name: r.name as string, quantity: n(r.quantity), salesMinor: n(r.sales) })),
        promos: { orders: n(promos?.orders), discountMinor: n(promos?.discount) },
      };
    },
    opts,
  );
}
