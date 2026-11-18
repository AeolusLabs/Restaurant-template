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
import { alertText } from "@/domain/alerts/text";
import { canRefund, nextActions } from "@/domain/orders/actions";
import { staffDeliveryLabel } from "@/domain/orders/presentation";
import type { OrderStatus } from "@/domain/orders/statuses";
import { dateTime, money } from "@/lib/format";
import { cancelAndRefundAction, refundAction, retryDeliveryAction, transitionAction } from "../actions";

export const metadata: Metadata = { title: "Order" };

async function Detail({ params, searchParams }: { params: PageProps<"/admin/orders/[code]">["params"]; searchParams: PageProps<"/admin/orders/[code]">["searchParams"] }) {
  const { code: raw } = await params;
  const code = raw.toUpperCase();
  const { ctx } = await requireStaff(["owner", "manager"], `/admin/orders/${code}`);
  const found = await getOrderForStaff(ctx, code);
  if (!found) notFound();
  const { order, items, phone, events, payments, refunds, delivery, dropoff } = found;
  const { notice, error } = await searchParams;
  const alerts = (await listOpenAlerts(ctx)).filter((a) => a.orderCode === code);

  const role = ctx.role as "owner" | "manager";
  const status = order.status as OrderStatus;
  const actions = nextActions(role, status, order.fulfilment);
  const forward = actions.filter((a) => !a.needsConfirm);
  const cancelAction = actions.find((a) => a.needsConfirm);
  const paid = payments.find((p) => p.status === "succeeded");
  const showRefund = canRefund(role, status) && !!paid;
  const delivering = order.fulfilment === "delivery";
  const canRetry = status === "delivery_failed";

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
              <li key={a.id}>{alertText(a.kind, a.payload)}</li>
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

      {(forward.length > 0 || cancelAction || showRefund || canRetry) && (
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
          {canRetry && (
            <form action={retryDeliveryAction} className="space-y-2">
              <input type="hidden" name="code" value={order.publicCode} />
              <p className="text-sm text-muted">The delivery failed. This books a new rider and puts the order back where it was. Or cancel and refund it below.</p>
              <button type="submit" className={button.primary}>
                Retry delivery
              </button>
            </form>
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
          {delivering ? "Customer and delivery" : "Customer and pickup"}
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
        {delivering ? (
          <p>
            {dropoff ? `${dropoff.address}, ${dropoff.zone}${dropoff.landmark ? ` (near ${dropoff.landmark})` : ""}` : "No delivery address on file"} &middot; placed {dateTime(order.placedAt)}
          </p>
        ) : (
          <p>{order.pickupAt ? `Pickup ${dateTime(order.pickupAt)}` : "No pickup time"} &middot; placed {dateTime(order.placedAt)}</p>
        )}
        {order.notes && (
          <p className="rounded-lg bg-warn-soft p-3">
            <strong>Note:</strong> {order.notes}
          </p>
        )}
      </section>

      {delivering && (
        <section className={`${card} space-y-2 p-4`} aria-labelledby="rider">
          <h2 id="rider" className="text-lg font-bold">
            Delivery
          </h2>
          {delivery ? (
            <>
              <p className="font-semibold">{staffDeliveryLabel(delivery.status)}</p>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted">Provider</dt>
                <dd>{delivery.provider}</dd>
                <dt className="text-muted">Booking reference</dt>
                <dd>{delivery.providerRef ?? "Not booked yet"}</dd>
                <dt className="text-muted">Attempts</dt>
                <dd>
                  {delivery.attempts} (round {delivery.round})
                </dd>
                <dt className="text-muted">Customer paid for delivery</dt>
                <dd>{money(delivery.feeChargedMinor)}</dd>
                <dt className="text-muted">Provider charged</dt>
                <dd>{delivery.providerCostMinor === null ? "Not booked yet" : money(delivery.providerCostMinor)}</dd>
              </dl>
              {delivery.status === "queued" && <p className="text-sm text-muted">Next booking attempt {dateTime(delivery.nextAttemptAt)}.</p>}
              {delivery.failureReason && (
                <p className="rounded-lg bg-warn-soft p-3 text-sm">
                  <strong>Last problem:</strong> {delivery.failureReason}
                </p>
              )}
              {delivery.trackingUrl && !["delivered", "cancelled", "failed"].includes(delivery.status) && (
                <a href={delivery.trackingUrl} target="_blank" rel="noopener noreferrer" className={button.secondary}>
                  Open the rider&apos;s tracking page
                </a>
              )}
            </>
          ) : (
            <p className="text-muted">No rider has been booked yet. A rider is booked when the order reaches the status set in the restaurant config.</p>
          )}
        </section>
      )}

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
          deliveryFeeMinor={order.deliveryFeeMinor}
          discountMinor={order.discountMinor}
          promoCode={order.promoCode}
          freeDelivery={delivering && order.deliveryFeeMinor === 0 && !!order.promoCode}
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

export default function OrderDetailPage(props: PageProps<"/admin/orders/[code]">) {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-line" role="status" aria-label="Loading order" />}>
      <Detail params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}
