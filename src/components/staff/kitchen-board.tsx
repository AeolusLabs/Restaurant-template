"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { advanceOrderAction } from "@/app/(kitchen)/kitchen/actions";
import { nextActions } from "@/domain/orders/actions";
import type { OrderStatus } from "@/domain/orders/statuses";
import type { StaffOrderJson } from "@/lib/sanitize";

type Props = {
  initial: StaffOrderJson[];
  role: "kitchen" | "manager" | "owner";
  timezone: string;
  locale: string;
};

const LANES: { title: string; hint: string; statuses: OrderStatus[] }[] = [
  { title: "New", hint: "Paid, waiting to be accepted", statuses: ["paid"] },
  { title: "Cooking", hint: "Accepted or being prepared", statuses: ["accepted", "preparing"] },
  { title: "Ready", hint: "Waiting for the customer", statuses: ["ready"] },
];
const POLL_MS = 10_000;

/**
 * The kitchen display. Orders arrive on their own: a live stream (Server-Sent Events) says something changed,
 * and the board refetches. It also refetches every 10 seconds, so a missed message or a dropped connection heals
 * itself, and says which of the two it is doing. Nothing needs a tap to appear.
 */
export function KitchenBoard({ initial, role, timezone, locale }: Props) {
  const [orders, setOrders] = useState(initial);
  const [live, setLive] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const refetching = useRef(false);

  const refetch = useCallback(async () => {
    if (refetching.current) return;
    refetching.current = true;
    try {
      const res = await fetch("/api/staff/kitchen", { cache: "no-store" });
      if (res.ok) setOrders(((await res.json()) as { orders: StaffOrderJson[] }).orders);
    } catch {
      // The next tick or event tries again.
    } finally {
      refetching.current = false;
    }
  }, []);

  useEffect(() => {
    const source = new EventSource("/api/stream/orders");
    source.addEventListener("open", () => setLive(true));
    source.addEventListener("error", () => setLive(false));
    source.addEventListener("order", () => void refetch());
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void refetch();
    }, POLL_MS);
    const tick = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      source.close();
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, [refetch]);

  const waitingNew = orders.filter((o) => o.status === "paid").length;
  useEffect(() => {
    document.title = waitingNew > 0 ? `(${waitingNew}) New orders | Kitchen` : "Kitchen";
  }, [waitingNew]);

  async function advance(order: StaffOrderJson, to: OrderStatus) {
    setBusy(order.publicCode);
    setMessage(null);
    try {
      const result = await advanceOrderAction(order.publicCode, to, order.status);
      if (!result.ok) setMessage(result.message);
    } catch {
      setMessage("That did not go through. Check the connection and try again.");
    } finally {
      setBusy(null);
      void refetch();
    }
  }

  const time = new Intl.DateTimeFormat(locale, { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: timezone });

  return (
    <div className="space-y-4">
      <p className="text-base" role="status">
        <span aria-hidden="true">{live ? "● " : "○ "}</span>
        {live ? "Live: new orders appear by themselves." : "Not live right now. Refreshing every 10 seconds."}
      </p>
      {message && (
        <p className="rounded-lg bg-warn-soft p-4 text-lg font-semibold text-warn" role="alert">
          {message}
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        {LANES.map((lane) => {
          const tickets = orders
            .filter((o) => lane.statuses.includes(o.status as OrderStatus))
            .sort((a, b) => (a.pickupAt ?? a.placedAt).localeCompare(b.pickupAt ?? b.placedAt) || a.placedAt.localeCompare(b.placedAt));
          return (
            <section key={lane.title} aria-labelledby={`lane-${lane.title}`} className="space-y-3">
              <h2 id={`lane-${lane.title}`} className="border-b-2 border-ink pb-2 text-2xl font-bold">
                {lane.title} <span className="text-muted">({tickets.length})</span>
              </h2>
              {tickets.length === 0 && <p className="text-lg text-muted">{lane.hint}. None right now.</p>}
              {tickets.map((o) => {
                const waiting = Math.max(0, Math.round((now - new Date(o.placedAt).getTime()) / 60_000));
                const actions = nextActions(role, o.status as OrderStatus, o.fulfilment as "pickup" | "delivery").filter((a) => !a.needsConfirm);
                return (
                  <article key={o.publicCode} className="space-y-3 rounded-xl border-2 border-ink bg-surface p-4" aria-label={`Order ${o.publicCode}`}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-3xl font-bold tracking-widest">
                        {o.publicCode}
                        {o.status === "paid" && <span className="ml-3 rounded bg-ink px-2 py-0.5 align-middle text-base tracking-normal text-surface">NEW</span>}
                      </p>
                      <p className="text-lg font-semibold">{o.pickupAt ? `Pickup ${time.format(new Date(o.pickupAt))}` : "Pickup"}</p>
                    </div>
                    <p className="text-base text-muted">
                      {o.customerName} &middot; waiting {waiting} min
                    </p>
                    <ul className="space-y-1 text-xl">
                      {o.items.map((i, n) => (
                        <li key={n}>
                          <span className="font-bold">{i.quantity} &times;</span> {i.name}
                          {i.modifiers.length > 0 && <span className="block text-base text-muted">{i.modifiers.map((m) => m.name).join(", ")}</span>}
                        </li>
                      ))}
                    </ul>
                    {o.notes && (
                      <p className="rounded-lg border-2 border-warn bg-warn-soft p-3 text-lg">
                        <strong>Note:</strong> {o.notes}
                      </p>
                    )}
                    <div className="grid gap-2">
                      {actions.map((a) => (
                        <button
                          key={a.to}
                          type="button"
                          disabled={busy !== null}
                          onClick={() => void advance(o, a.to)}
                          className="min-h-16 rounded-xl bg-brand px-4 text-xl font-bold text-on-brand hover:brightness-110 disabled:opacity-50"
                        >
                          {busy === o.publicCode ? "Working…" : a.label}
                        </button>
                      ))}
                    </div>
                  </article>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}
