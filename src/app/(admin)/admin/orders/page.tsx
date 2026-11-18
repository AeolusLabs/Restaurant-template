import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireStaff } from "@/auth/customer";
import { Notice } from "@/components/staff/notice";
import { StatusBadge } from "@/components/staff/status-badge";
import { button, card, field, label } from "@/components/ui";
import { listOrdersForStaff } from "@/db/staff-orders";
import type { OrderStatus } from "@/domain/orders/statuses";
import { dateTime, money } from "@/lib/format";

export const metadata: Metadata = { title: "Orders" };

const VIEWS: { id: string; label: string; statuses?: OrderStatus[] }[] = [
  { id: "needs", label: "Needs accepting", statuses: ["paid"] },
  { id: "progress", label: "In progress", statuses: ["accepted", "preparing", "ready"] },
  { id: "done", label: "Collected", statuses: ["picked_up", "completed"] },
  { id: "closed", label: "Cancelled and refunded", statuses: ["cancelled", "refunded"] },
  { id: "unpaid", label: "Unpaid", statuses: ["placed"] },
  { id: "all", label: "All" },
];

async function Orders({ searchParams }: { searchParams: PageProps<"/admin/orders">["searchParams"] }) {
  const params = await searchParams;
  const { ctx } = await requireStaff(["owner", "manager"], "/admin/orders");
  const view = VIEWS.find((v) => v.id === params.view) ?? VIEWS[1];
  const q = typeof params.q === "string" ? params.q : "";
  const rows = await listOrdersForStaff(ctx, { statuses: view.statuses, search: q, limit: 100 });

  return (
    <div className="space-y-5">
      <Notice notice={params.notice} error={params.error} />
      <nav aria-label="Order filters" className="flex flex-wrap gap-2">
        {VIEWS.map((v) => (
          <Link
            key={v.id}
            href={`/admin/orders?view=${v.id}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
            aria-current={v.id === view.id ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-full border px-4 text-base font-semibold ${v.id === view.id ? "border-brand bg-brand-soft" : "border-line-strong bg-surface hover:bg-brand-soft"}`}
          >
            {v.label}
          </Link>
        ))}
      </nav>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="view" value={view.id} />
        <div className="min-w-48 flex-1">
          <label htmlFor="q" className={label}>
            Find by order code or customer name
          </label>
          <input id="q" name="q" defaultValue={q} className={field} autoComplete="off" />
        </div>
        <button type="submit" className={button.secondary}>
          Search
        </button>
      </form>

      {rows.length === 0 ? (
        <p className={`${card} p-6 text-muted`}>No orders here.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map(({ order, items }) => (
            <li key={order.id}>
              <Link href={`/admin/orders/${order.publicCode}`} className={`${card} flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-4 hover:bg-brand-soft`}>
                <span>
                  <span className="block text-lg font-bold tracking-widest">{order.publicCode}</span>
                  <span className="block text-sm text-muted">
                    {order.customerName} &middot; {items.reduce((n, i) => n + i.quantity, 0)} items
                  </span>
                </span>
                <span className="text-sm text-muted">{order.fulfilment === "delivery" ? `Delivery · ${dateTime(order.placedAt)}` : order.pickupAt ? `Pickup ${dateTime(order.pickupAt)}` : dateTime(order.placedAt)}</span>
                <span className="flex items-center gap-3">
                  <span className="font-semibold">{money(order.totalMinor)}</span>
                  <StatusBadge status={order.status} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {rows.length === 100 && <p className="text-sm text-muted">Showing the newest 100. Use search or a filter to narrow it down.</p>}
    </div>
  );
}

export default function OrdersPage(props: PageProps<"/admin/orders">) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold leading-tight">Orders</h1>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-line" role="status" aria-label="Loading orders" />}>
        <Orders searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
