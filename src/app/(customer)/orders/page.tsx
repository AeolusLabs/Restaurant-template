import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireCustomer } from "@/auth/customer";
import { button, card } from "@/components/ui";
import { listOrdersForCustomer } from "@/db/orders";
import { describeStatus } from "@/domain/orders/presentation";
import { dateTime, money } from "@/lib/format";

export const metadata: Metadata = { title: "My orders" };

async function Orders() {
  const { ctx } = await requireCustomer("/orders");
  const orders = await listOrdersForCustomer(ctx);
  if (orders.length === 0) {
    return (
      <div className={`${card} space-y-4 p-6`}>
        <p className="text-lg font-semibold">You have not placed an order yet.</p>
        <Link href="/" className={button.primary}>
          See the menu
        </Link>
      </div>
    );
  }
  return (
    <ul className="space-y-3">
      {orders.map((o) => (
        <li key={o.id}>
          <Link href={`/orders/${o.publicCode}`} className={`${card} flex flex-wrap items-center justify-between gap-x-4 gap-y-1 p-4 hover:bg-brand-soft`}>
            <span>
              <span className="block font-bold tracking-widest">{o.publicCode}</span>
              <span className="block text-sm text-muted">{dateTime(o.placedAt)}</span>
            </span>
            <span className="text-right">
              <span className="block font-semibold">{describeStatus(o.status, o.fulfilment).headline}</span>
              <span className="block text-sm text-muted">{money(o.totalMinor)}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function OrdersPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold leading-tight">My orders</h1>
      <Suspense fallback={<div className="h-32 animate-pulse rounded-xl bg-line" role="status" aria-label="Loading your orders" />}>
        <Orders />
      </Suspense>
    </div>
  );
}
