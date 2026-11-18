"use client";

import { useEffect, useState } from "react";
import { useCart } from "@/components/cart/store";
import { OrderTotals } from "@/components/cart/totals";
import { useMoney } from "@/components/money-context";
import { button, card } from "@/components/ui";
import { describeRider, describeStatus, isFinished, stepIndex, stepsFor, type Tone } from "@/domain/orders/presentation";
import type { OrderStatus } from "@/domain/orders/statuses";
import type { PublicOrder } from "@/lib/sanitize";

type Props = {
  initial: PublicOrder;
  /** Pre-formatted on the server in the restaurant's timezone and locale. */
  pickupLabel: string | null;
  holdUntilLabel: string | null;
  address: string;
  charges: { serviceChargeBps: number; taxBps: number; pricesIncludeCharges: boolean };
};

const POLL_MS = 4000;
const TONE: Record<Tone, string> = {
  info: "border-line-strong bg-surface text-ink",
  ok: "border-ok bg-ok-soft text-ink",
  warn: "border-warn bg-warn-soft text-ink",
  bad: "border-bad bg-bad-soft text-ink",
};
const MARK: Record<Tone, string> = { info: "•", ok: "✓", warn: "!", bad: "✕" };

/**
 * Shows an order and keeps it current by polling while the page is visible. The status is never taken from
 * the payment redirect: it only changes when the server says so, after a verified payment.
 */
export function OrderTracker({ initial, pickupLabel, holdUntilLabel, address, charges }: Props) {
  const [order, setOrder] = useState(initial);
  const money = useMoney();
  const { clear } = useCart();
  const status = order.status as OrderStatus;
  const finished = isFinished(status);

  useEffect(() => {
    if (finished) return;
    let stopped = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/orders/${order.publicCode}`, { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as { order?: PublicOrder };
        if (!stopped && body.order) setOrder(body.order);
      } catch {
        // A dropped connection: the next tick tries again.
      }
    };
    const id = window.setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      stopped = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [finished, order.publicCode]);

  // Once the order is paid, the cart it came from has done its job.
  useEffect(() => {
    if (status !== "placed" && status !== "cancelled") clear();
  }, [status, clear]);

  const delivering = order.fulfilment === "delivery";
  const d = describeStatus(status, order.fulfilment);
  const current = stepIndex(status, order.fulfilment);
  const rider = delivering && !finished ? describeRider(order.delivery?.status) : null;
  // The rider's own page, only while the delivery is live.
  const trackingUrl = delivering && !finished && status !== "delivery_failed" ? order.delivery?.trackingUrl : null;

  return (
    <div className="space-y-8">
      <section className={`${card} p-5 text-center`} aria-labelledby="code-label">
        <p id="code-label" className="text-sm font-semibold text-muted">
          Your order code
        </p>
        <p className="mt-1 text-2xl font-bold tracking-[0.2em]" aria-label={order.publicCode.split("").join(" ")}>
          {order.publicCode}
        </p>
      </section>

      <section className={`rounded-xl border-2 p-4 ${TONE[d.tone]}`} aria-live="polite" aria-atomic="true">
        <p className="flex items-center gap-2 text-lg font-bold">
          <span aria-hidden="true" className="inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-current text-sm">
            {MARK[d.tone]}
          </span>
          {d.headline}
        </p>
        <p className="mt-1">{d.detail}</p>
        {status === "placed" && holdUntilLabel && <p className="mt-1 text-sm text-muted">We hold this order until {holdUntilLabel}.</p>}
      </section>

      {current !== null && (
        <ol className="space-y-1" aria-label="Order progress">
          {stepsFor(order.fulfilment).map((step, i) => {
            const state = i < current ? "Done" : i === current ? "Now" : "Next";
            return (
              <li
                key={step.status}
                aria-current={i === current ? "step" : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 ${i === current ? "bg-brand-soft font-semibold" : ""} ${i > current ? "text-muted" : ""}`}
              >
                <span aria-hidden="true" className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-current text-xs">
                  {i < current ? "✓" : i + 1}
                </span>
                <span className="flex-1">{step.label}</span>
                <span className="text-sm">{state}</span>
              </li>
            );
          })}
        </ol>
      )}

      {delivering ? (
        <section aria-labelledby="delivery-h" className="space-y-2">
          <h2 id="delivery-h" className="text-lg font-bold">
            Delivery
          </h2>
          {order.dropoff && (
            <p>
              {order.dropoff.address}
              <span className="block text-muted">
                {order.dropoff.zone}
                {order.dropoff.landmark ? `, near ${order.dropoff.landmark}` : ""}
              </span>
            </p>
          )}
          {rider && <p aria-live="polite">{rider}</p>}
          {trackingUrl && (
            <a href={trackingUrl} target="_blank" rel="noopener noreferrer" className={button.secondary}>
              Follow your rider
            </a>
          )}
        </section>
      ) : (
        <section aria-labelledby="pickup-h" className="space-y-1">
          <h2 id="pickup-h" className="text-lg font-bold">
            Pickup
          </h2>
          {pickupLabel && <p>{pickupLabel}</p>}
          <p className="text-muted">{address}</p>
        </section>
      )}

      <section aria-labelledby="items-h" className="space-y-3">
        <h2 id="items-h" className="text-lg font-bold">
          Items
        </h2>
        <ul className="divide-y divide-line">
          {order.items.map((item, i) => (
            <li key={i} className="flex justify-between gap-4 py-2">
              <span>
                {item.quantity} &times; {item.name}
                {item.modifiers.length > 0 && <span className="block text-sm text-muted">{item.modifiers.map((m) => m.name).join(", ")}</span>}
              </span>
              <span className="shrink-0 tabular-nums">{money(item.lineTotalMinor)}</span>
            </li>
          ))}
        </ul>
        {order.notes && <p className="text-sm text-muted">Your note: {order.notes}</p>}
        <div className={`${card} p-4`}>
          <OrderTotals
            subtotalMinor={order.subtotalMinor}
            serviceChargeMinor={order.serviceChargeMinor}
            taxMinor={order.taxMinor}
            deliveryFeeMinor={order.deliveryFeeMinor}
            discountMinor={order.discountMinor}
            promoCode={order.promoCode}
            freeDelivery={delivering && order.deliveryFeeMinor === 0 && !!order.promoCode}
            totalMinor={order.totalMinor}
            charges={charges}
          />
        </div>
      </section>
    </div>
  );
}
