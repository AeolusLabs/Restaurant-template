import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { restaurantConfig as c } from "../../../../../../config/restaurant";
import { requireStaff } from "@/auth/customer";
import { OrderTotals } from "@/components/cart/totals";
import { Notice } from "@/components/staff/notice";
import { StatusBadge } from "@/components/staff/status-badge";
import { button, card, field, label } from "@/components/ui";
import { listOpenAlerts } from "@/db/alerts";
import { getOrderForStaff } from "@/db/staff-orders";
import { canRefund, nextActions } from "@/domain/orders/actions";
import type { OrderStatus } from "@/domain/orders/statuses";
import { dateTime, money } from "@/lib/format";
import { cancelAndRefundAction, refundAction, transitionAction } from "../actions";

export const metadata: Metadata = { title: "Order" };

async function Detail({ params, searchParams }: { params: PageProps<"/admin/orders/[code]">["params"]; searchParams: PageProps<"/admin/orders/[code]">["searchParams"] }) {
  const { code: raw } = await params;
  const code = raw.toUpperCase();
  const { ctx } = await requireStaff(["owner", "manager"], `/admin/orders/${code}`);
  const found = await getOrderForStaff(ctx, code);
  if (!found) notFound();
  const { order, items, phone, events, payments, refunds } = found;
  const { notice, error } = await searchParams;
  const alerts = (await listOpenAlerts(ctx)).filter((a) => a.orderCode === code);

  const role = ctx.role as "owner" | "manager";
  const status = order.status as OrderStatus;
  const actions = nextActions(role, status, order.fulfilment);
  const forward = actions.filter((a) => !a.needsConfirm);
  const cancelAction = actions.find((a) => a.needsConfirm);
  const paid = payments.find((p) => p.status === "succeeded");
  const showRefund = canRefund(role, status) && !!paid;

  return (
    <div className="space-y-6">
      <Notice notice={notice} error={error} />

      {alerts.length > 0 && (
        <section className="space-y-2 rounded-xl border-2 border-bad bg-bad-soft p-4" aria-label="Alerts for this order">
          <h2 className="font-bold text-bad">
            <span aria-hidden="true">&#9888; </span>Needs attention
          </h2>
          <ul className="list-inside list-disc text-sm">
            {alerts.map((a) => (
              <li key={a.id}>{alertText(a.kind)}</li>
            ))}
          </ul>
          <Link href="/admin" className={button.secondary}>
            Go to alerts
          </Link>
        </section>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-3xl font-bold tracking-widest">{order.publicCode}</p>
        <StatusBadge status={status} />
      </div>

      {(forward.length > 0 || cancelAction || showRefund) && (
        <section className={`${card} space-y-4 p-4`} aria-label="Actions">
          {forward.length > 0 && (
            <div className="flex flex-wrap gap-3">
              {forward.map((a) => (
                <form key={a.to} action={transitionAction}>
                  <input type="hidden" name="code" value={order.publicCode} />
                  <input type="hidden" name="to" value={a.to} />
                  <input type="hidden" name="from" value={status} />
                  <button type="submit" className={button.primary}>
                    {a.label}
                  </button>
                </form>
              ))}
            </div>
          )}
          {cancelAction && (
            <details>
              <summary className={`${button.danger} cursor-pointer list-none`}>{paid ? "Cancel and refund…" : "Cancel order…"}</summary>
              <form action={cancelAndRefundAction} className="mt-3 space-y-3 rounded-lg border border-bad p-3">
                <input type="hidden" name="code" value={order.publicCode} />
                <p>{paid ? `This cancels the order and returns ${money(paid.amountMinor)} to the customer.` : "This cancels the order."}</p>
                <div>
                  <label htmlFor="cancel-reason" className={label}>
                    Reason (the customer is not sent this)
                  </label>
                  <input id="cancel-reason" name="reason" maxLength={200} className={field} />
                </div>
                <button type="submit" className={button.danger}>
                  Yes, cancel it
                </button>
              </form>
            </details>
          )}
          {showRefund && (
            <details>
              <summary className={`${button.secondary} cursor-pointer list-none`}>Refund {money(paid!.amountMinor)}&hellip;</summary>
              <form action={refundAction} className="mt-3 space-y-3 rounded-lg border border-line-strong p-3">
                <input type="hidden" name="code" value={order.publicCode} />
                <p>This returns the whole payment to the customer. It cannot be undone.</p>
                <div>
                  <label htmlFor="refund-reason" className={label}>
                    Reason
                  </label>
                  <input id="refund-reason" name="reason" maxLength={200} className={field} />
                </div>
                <button type="submit" className={button.danger}>
                  Yes, refund {money(paid!.amountMinor)}
                </button>
              </form>
            </details>
          )}
        </section>
      )}

      <section className={`${card} space-y-2 p-4`} aria-labelledby="who">
        <h2 id="who" className="text-lg font-bold">
          Customer and pickup
        </h2>
        <p>{order.customerName}</p>
        {phone ? (
          <p>
            <a href={`tel:${phone.replace(/[^+\d]/g, "")}`} className="font-semibold text-brand underline underline-offset-4">
              {phone}
            </a>
          </p>
        ) : (
          <p className="text-muted">No phone number on file.</p>
        )}
        <p>{order.pickupAt ? `Pickup ${dateTime(order.pickupAt)}` : "No pickup time"} &middot; placed {dateTime(order.placedAt)}</p>
        {order.notes && (
          <p className="rounded-lg bg-warn-soft p-3">
            <strong>Note:</strong> {order.notes}
          </p>
        )}
      </section>

      <section className={`${card} space-y-3 p-4`} aria-labelledby="items">
        <h2 id="items" className="text-lg font-bold">
          Items
        </h2>
        <ul className="divide-y divide-line">
          {items.map((i, n) => (
            <li key={n} className="flex justify-between gap-4 py-2">
              <span>
                {i.quantity} &times; {i.name}
                {i.modifiers.length > 0 && <span className="block text-sm text-muted">{i.modifiers.map((m) => m.name).join(", ")}</span>}
              </span>
              <span className="tabular-nums">{money(i.lineTotalMinor)}</span>
            </li>
          ))}
        </ul>
        <OrderTotals
          subtotalMinor={order.subtotalMinor}
          serviceChargeMinor={order.serviceChargeMinor}
          taxMinor={order.taxMinor}
          totalMinor={order.totalMinor}
          charges={c.charges}
        />
      </section>

      <section className={`${card} space-y-2 p-4`} aria-labelledby="money">
        <h2 id="money" className="text-lg font-bold">
          Payments and refunds
        </h2>
        {payments.length === 0 ? (
          <p className="text-muted">No payment attempts.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {payments.map((p) => (
              <li key={p.reference}>
                {money(p.amountMinor)} &middot; {p.status} &middot; {p.provider} <span className="text-muted">({p.reference})</span>
              </li>
            ))}
          </ul>
        )}
        {refunds.map((r, n) => (
          <p key={n} className="text-sm">
            Refund {money(r.amountMinor)} &middot; {r.status}
            {r.reason ? ` · ${r.reason}` : ""}
          </p>
        ))}
      </section>

      <section className={`${card} space-y-2 p-4`} aria-labelledby="history">
        <h2 id="history" className="text-lg font-bold">
          History
        </h2>
        <ol className="space-y-1 text-sm">
          {events.map((e, n) => (
            <li key={n}>
              {dateTime(e.at)} &middot; {e.from ?? "start"} to {e.to} &middot; {e.actor}
              {e.reason ? ` · ${e.reason}` : ""}
            </li>
          ))}
          {events.length === 0 && <li className="text-muted">No changes yet.</li>}
        </ol>
      </section>

      <Link href="/admin/orders" className={button.quiet}>
        All orders
      </Link>
    </div>
  );
}

const alertText = (kind: string) =>
  ({
    payment_mismatch: "A payment came in for the wrong amount and was not applied. Check the payment provider and refund it if the money was taken.",
    payment_late: "A payment arrived after this order was cancelled. The customer has paid for nothing: refund them.",
    payment_duplicate: "The customer paid twice. Refund the extra payment from the payment provider.",
    refund_failed: "A refund did not go through. Try the refund again from the actions above.",
  })[kind] ?? kind;

export default function OrderDetailPage(props: PageProps<"/admin/orders/[code]">) {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-line" role="status" aria-label="Loading order" />}>
      <Detail params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}
