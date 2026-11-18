import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireStaff } from "@/auth/customer";
import { Notice } from "@/components/staff/notice";
import { StatusBadge } from "@/components/staff/status-badge";
import { button, card } from "@/components/ui";
import { getCustomer } from "@/db/customers";
import type { OrderStatus } from "@/domain/orders/statuses";
import { dateTime, money } from "@/lib/format";
import { setCustomerBlockedAction } from "../actions";

export const metadata: Metadata = { title: "Customer" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function Detail({ params, searchParams }: { params: PageProps<"/admin/customers/[id]">["params"]; searchParams: PageProps<"/admin/customers/[id]">["searchParams"] }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { ctx } = await requireStaff(["owner", "manager"], `/admin/customers/${id}`);
  const c = await getCustomer(ctx, id);
  if (!c) notFound();
  const { notice, error } = await searchParams;

  return (
    <div className="space-y-6">
      <Notice notice={notice} error={error} />

      <section className={`${card} space-y-2 p-4`} aria-labelledby="who">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="who" className="text-2xl font-bold">
            {c.name}
          </h2>
          {c.blocked && <span className="rounded-full border border-bad bg-bad-soft px-3 py-1 text-sm font-semibold">Blocked</span>}
        </div>
        <p>{c.email}</p>
        {c.phone ? (
          <p>
            <a href={`tel:${c.phone.replace(/[^+\d]/g, "")}`} className="font-semibold text-brand underline underline-offset-4">
              {c.phone}
            </a>
          </p>
        ) : (
          <p className="text-muted">No phone number on file.</p>
        )}
        <p className="text-sm text-muted">
          Joined {dateTime(c.joinedAt)}. {c.marketingConsent ? "Agreed to hear from the restaurant about offers." : "Has not agreed to marketing messages."}
        </p>
      </section>

      <section className={`${card} p-4`} aria-label="Totals">
        <dl className="grid grid-cols-2 gap-4">
          <div>
            <dt className="text-sm text-muted">Orders</dt>
            <dd className="text-2xl font-bold tabular-nums">{c.orders}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Spent on completed orders</dt>
            <dd className="text-2xl font-bold tabular-nums">{money(c.spentMinor)}</dd>
          </div>
        </dl>
      </section>

      <section className={`${card} space-y-3 p-4`} aria-labelledby="orders">
        <h2 id="orders" className="text-lg font-bold">
          Orders
        </h2>
        {c.orderList.length === 0 ? (
          <p className="text-muted">No orders yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {c.orderList.map((o) => (
              <li key={o.publicCode} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <span>
                  <Link href={`/admin/orders/${o.publicCode}`} className="font-bold tracking-widest text-brand underline underline-offset-4">
                    {o.publicCode}
                  </Link>
                  <span className="block text-sm text-muted">
                    {dateTime(o.placedAt)} · {o.fulfilment === "delivery" ? "Delivery" : "Pickup"}
                    {o.promoCode ? ` · code ${o.promoCode}` : ""}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <StatusBadge status={o.status as OrderStatus} />
                  <span className="tabular-nums">{money(o.totalMinor)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={`${card} space-y-2 p-4`} aria-labelledby="access">
        <h2 id="access" className="text-lg font-bold">
          Access
        </h2>
        {c.blocked ? (
          <form action={setCustomerBlockedAction} className="space-y-2">
            <input type="hidden" name="id" value={c.id} />
            <input type="hidden" name="blocked" value="false" />
            <p className="text-sm text-muted">This customer cannot sign in or order.</p>
            <button type="submit" className={button.secondary}>
              Unblock
            </button>
          </form>
        ) : (
          <details>
            <summary className={`${button.danger} cursor-pointer list-none`}>Block this customer…</summary>
            <form action={setCustomerBlockedAction} className="mt-3 space-y-3 rounded-lg border border-bad p-3">
              <input type="hidden" name="id" value={c.id} />
              <input type="hidden" name="blocked" value="true" />
              <p>They will not be able to sign in or place orders. Their past orders stay as they are, and you can unblock them at any time.</p>
              <button type="submit" className={button.danger}>
                Yes, block them
              </button>
            </form>
          </details>
        )}
      </section>

      <Link href="/admin/customers" className={button.quiet}>
        All customers
      </Link>
    </div>
  );
}

export default function CustomerPage(props: PageProps<"/admin/customers/[id]">) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold leading-tight">Customer</h1>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-line" role="status" aria-label="Loading customer" />}>
        <Detail params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
