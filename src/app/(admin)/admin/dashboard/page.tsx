import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { restaurantConfig as c } from "../../../../../config/restaurant";
import { requireStaff } from "@/auth/customer";
import { ColumnChart, HeatLegend, Heatmap, RankedBars, SegmentedBar, TableView } from "@/components/dashboard/charts";
import { button, card } from "@/components/ui";
import { loadDashboard } from "@/db/dashboard";
import { busiestCell, changePercent, deliveryVerdict } from "@/domain/dashboard/rules";
import { money, moneyCompact } from "@/lib/format";

export const metadata: Metadata = { title: "Dashboard" };

const CHOICES = [7, 30, 90] as const;
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function parseDays(raw: string | string[] | undefined): (typeof CHOICES)[number] {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "7" ? 7 : v === "90" ? 90 : 30;
}

const section = `${card} space-y-4 p-4 sm:p-5`;
const h2 = "text-lg font-bold";

async function Dashboard({ searchParams }: { searchParams: PageProps<"/admin/dashboard">["searchParams"] }) {
  await connection(); // every period is measured from now
  const params = await searchParams;
  const { ctx } = await requireStaff(["owner", "manager"], "/admin/dashboard");
  const days = parseDays(params.days);
  const d = await loadDashboard(ctx, { days });
  const { sales } = d;

  const change = changePercent(sales.salesMinor, sales.prevSalesMinor);
  const average = sales.orders > 0 ? Math.round(sales.salesMinor / sales.orders) : 0;
  const busiest = busiestCell(d.hours);
  const verdict = deliveryVerdict(d.delivery);
  const customers = d.customers.newCustomers + d.customers.returning;
  const label = (i: number) => {
    const day = d.period.localDays[i];
    const w = SHORT[(["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const).indexOf(day.weekday)];
    return days === 7 ? w : `${day.d} ${MONTHS[day.m - 1]}`;
  };
  const dayName = (i: number) => {
    const day = d.period.localDays[i];
    return `${SHORT[(["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const).indexOf(day.weekday)]} ${day.d} ${MONTHS[day.m - 1]}`;
  };

  return (
    <div className="viz space-y-6">
      <nav aria-label="Period" className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">Show the last:</span>
        {CHOICES.map((n) => (
          <Link key={n} href={`/admin/dashboard?days=${n}`} aria-current={n === days ? "page" : undefined} className={n === days ? button.primary : button.secondary}>
            {n} days
          </Link>
        ))}
      </nav>

      <section className={section} aria-labelledby="sales-h">
        <h2 id="sales-h" className={h2}>
          Sales in the last {days} days
        </h2>
        {sales.orders === 0 && sales.refundedOrders === 0 ? (
          <p className="text-muted">No orders were paid in this period yet. When they are, this page fills in by itself.</p>
        ) : (
          <>
            <p className="text-5xl font-bold leading-tight">{money(sales.salesMinor)}</p>
            <p>
              From {plural(sales.orders, "order")}, {sales.orders > 0 ? `${money(average)} on average` : "nothing sold"}. Today is counted so far.
            </p>
            <p>
              {change === null ? (
                <span className="text-muted">{sales.prevSalesMinor === 0 ? `There were no sales in the ${days} days before, so there is nothing to compare with.` : ""}</span>
              ) : (
                <span className={change > 0 ? "font-semibold text-ok" : change < 0 ? "font-semibold text-bad" : "font-semibold"}>
                  <span aria-hidden="true">{change > 0 ? "▲ " : change < 0 ? "▼ " : "● "}</span>
                  {change > 0 ? `Up ${change}%` : change < 0 ? `Down ${Math.abs(change)}%` : "The same"} on the {days} days before ({money(sales.prevSalesMinor)} from {plural(sales.prevOrders, "order")}).
                </span>
              )}
            </p>
            {sales.refundedOrders > 0 && (
              <p className="text-sm text-muted">
                Not counted: {money(sales.refundedMinor)} refunded on {plural(sales.refundedOrders, "order")}.
              </p>
            )}
            <ColumnChart
              data={d.daily.map((x, i) => ({ key: x.key, label: label(i), value: x.salesMinor, tooltip: `${dayName(i)}: ${money(x.salesMinor)} from ${plural(x.orders, "order")}` }))}
              format={moneyCompact}
              ariaLabel={`Sales for each of the last ${days} days. Total ${money(sales.salesMinor)}.`}
            />
            <TableView caption="Sales for each day" columns={["Day", "Orders", "Sales"]} rows={d.daily.map((x, i) => [dayName(i), x.orders, money(x.salesMinor)])} />
          </>
        )}
      </section>

      <section className={section} aria-labelledby="busy-h">
        <h2 id="busy-h" className={h2}>
          Busiest times
        </h2>
        {busiest ? (
          <>
            <p>
              Busiest: <strong>{DAY_NAMES[busiest.weekday - 1]}s, {hh(busiest.hour)} to {hh((busiest.hour + 1) % 24)}</strong>, with {plural(busiest.orders, "order")} over these {days} days. Have the kitchen ready for it.
            </p>
            <Heatmap cells={d.hours} hourLabel={hh} ariaLabel={`Orders by day of the week and hour. Busiest is ${DAY_NAMES[busiest.weekday - 1]} at ${hh(busiest.hour)}.`} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <HeatLegend />
              <span className="text-sm text-muted">Hours of the day, {c.timezone} time</span>
            </div>
            <TableView
              caption="Orders by day and hour"
              columns={["Day and hour", "Orders"]}
              rows={[...d.hours].filter((x) => x.orders > 0).sort((a, b) => b.orders - a.orders || a.weekday - b.weekday || a.hour - b.hour).map((x) => [`${DAY_NAMES[x.weekday - 1]} ${hh(x.hour)}`, x.orders])}
            />
          </>
        ) : (
          <p className="text-muted">No orders in this period, so there is no pattern to show yet.</p>
        )}
      </section>

      <section className={section} aria-labelledby="cust-h">
        <h2 id="cust-h" className={h2}>
          Customers coming back
        </h2>
        {customers === 0 ? (
          <p className="text-muted">No customers ordered in this period.</p>
        ) : (
          <>
            <p>
              {plural(customers, "customer")} ordered. <strong>{d.customers.returning}</strong> had ordered before ({Math.round((d.customers.returning / customers) * 100)}%), <strong>{d.customers.newCustomers}</strong> {d.customers.newCustomers === 1 ? "was" : "were"} new.
            </p>
            <SegmentedBar
              ariaLabel={`${d.customers.returning} returning customers and ${d.customers.newCustomers} new customers`}
              parts={[
                { key: "returning", label: "Returning", value: d.customers.returning, color: "1" },
                { key: "new", label: "New", value: d.customers.newCustomers, color: "2" },
              ]}
            />
            <p className="text-sm text-muted">
              A customer counts once however often they ordered. <Link href="/admin/customers?sort=spend" className="font-semibold text-brand underline underline-offset-4">See who spends the most</Link>.
            </p>
          </>
        )}
      </section>

      <section className={section} aria-labelledby="top-h">
        <h2 id="top-h" className={h2}>
          Best sellers
        </h2>
        {d.topItems.length === 0 ? (
          <p className="text-muted">No dishes were sold in this period.</p>
        ) : (
          <>
            <RankedBars ariaLabel="Dishes sold, most first" rows={d.topItems.map((t) => ({ key: t.name, label: t.name, value: t.quantity, figure: `${t.quantity} sold` }))} />
            <TableView caption="Best sellers" columns={["Dish", "Sold", "Sales"]} rows={d.topItems.map((t) => [t.name, t.quantity, money(t.salesMinor)])} />
          </>
        )}
      </section>

      {c.features.delivery && (
        <section className={section} aria-labelledby="del-h">
          <h2 id="del-h" className={h2}>
            Does delivery pay for itself?
          </h2>
          {d.fulfilment.delivery.orders > 0 && (
            <p className="text-sm text-muted">
              Delivery was {plural(d.fulfilment.delivery.orders, "order")} and {money(d.fulfilment.delivery.salesMinor)} of sales; pickup was {plural(d.fulfilment.pickup.orders, "order")} and {money(d.fulfilment.pickup.salesMinor)}.
            </p>
          )}
          {verdict.kind === "none" ? (
            <p className="text-muted">No delivery with a booked rider in this period, so there is no cost to compare yet.</p>
          ) : (
            <>
              <RankedBars
                ariaLabel="What customers paid for delivery against what the riders cost"
                rows={[
                  { key: "paid", label: "Customers paid for delivery", value: d.delivery.collectedMinor, figure: money(d.delivery.collectedMinor), color: "1" },
                  { key: "cost", label: "The riders cost", value: d.delivery.costMinor, figure: money(d.delivery.costMinor), color: "2" },
                ]}
              />
              {verdict.kind === "loss" ? (
                <div className="space-y-1 rounded-lg border-2 border-bad bg-bad-soft p-4" role="status">
                  <p className="font-bold text-bad">
                    <span aria-hidden="true">&#9888; </span>Delivery cost you {money(-verdict.netMinor)} more than customers paid
                  </p>
                  <p>
                    That is {money(-verdict.perDeliveryMinor)} on each of {plural(d.delivery.deliveries, "delivery", "deliveries")}.
                    {d.delivery.freeDeliveries > 0 ? ` ${d.delivery.freeDeliveries} of them had free delivery.` : ""} Raise the zone fees in <code>config/restaurant.ts</code>, or limit free-delivery codes.
                  </p>
                </div>
              ) : (
                <p>
                  {verdict.kind === "profit" ? `Customers paid ${money(verdict.netMinor)} more than the riders cost` : "Customers paid exactly what the riders cost"}, across {plural(d.delivery.deliveries, "delivery", "deliveries")}
                  {verdict.kind === "profit" ? ` (${money(verdict.perDeliveryMinor)} each)` : ""}.
                  {d.delivery.freeDeliveries > 0 ? ` ${d.delivery.freeDeliveries} had free delivery.` : ""}
                </p>
              )}
              <TableView
                caption="Delivery fees against rider cost"
                columns={["", "Amount"]}
                rows={[
                  ["Deliveries with a booked rider", d.delivery.deliveries],
                  ["Customers paid for delivery", money(d.delivery.collectedMinor)],
                  ["The riders cost", money(d.delivery.costMinor)],
                  ["Difference", money(verdict.netMinor)],
                ]}
              />
            </>
          )}
        </section>
      )}

      {c.features.promos && (
        <section className={section} aria-labelledby="promo-h">
          <h2 id="promo-h" className={h2}>
            Promo codes
          </h2>
          <p>
            {d.promos.orders > 0 ? `Codes took ${money(d.promos.discountMinor)} off ${plural(d.promos.orders, "order")} in this period.` : "No promo codes were used in this period."}{" "}
            <Link href="/admin/promos" className="font-semibold text-brand underline underline-offset-4">
              Manage promos
            </Link>
          </p>
        </section>
      )}

      <p className="text-sm text-muted">
        Sales are orders that were paid and not refunded, counted when they were paid. Days and hours are {c.timezone} time. Every figure is added up from the orders themselves; nothing is estimated.
      </p>
    </div>
  );
}

export default function DashboardPage(props: PageProps<"/admin/dashboard">) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold leading-tight">Dashboard</h1>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-line" role="status" aria-label="Loading the dashboard" />}>
        <Dashboard searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
