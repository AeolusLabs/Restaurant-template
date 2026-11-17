"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { placeOrderAction } from "@/app/checkout/actions";
import { useMoney } from "@/components/money-context";
import { problemText } from "@/components/cart/problems";
import { useCart } from "@/components/cart/store";
import { OrderTotals } from "@/components/cart/totals";
import { useQuote } from "@/components/cart/use-quote";
import { button, card, field, label } from "@/components/ui";

type Props = {
  days: { day: string; slots: { value: string; label: string }[] }[];
  defaultPhone: string;
  checkoutToken: string;
  address: string;
};

function PayButton({ totalMinor, disabled }: { totalMinor: number | null; disabled: boolean }) {
  const { pending } = useFormStatus();
  const money = useMoney();
  return (
    <button type="submit" className={`${button.primary} w-full sm:w-auto`} disabled={disabled || pending} aria-disabled={disabled || pending}>
      {pending ? "Taking you to payment…" : totalMinor === null ? "Pay" : `Pay ${money(totalMinor)}`}
    </button>
  );
}

export function CheckoutForm({ days, defaultPhone, checkoutToken, address }: Props) {
  const { lines } = useCart();
  const { quote, loading } = useQuote(lines);
  const [state, action] = useActionState(placeOrderAction, undefined);
  const fe = state?.fieldErrors ?? {};
  const v = state?.values ?? {};

  if (lines.length === 0) {
    return (
      <div className={`${card} space-y-4 p-6`}>
        <p className="text-lg font-semibold">Your cart is empty.</p>
        <Link href="/" className={button.primary}>
          See the menu
        </Link>
      </div>
    );
  }

  const ready = quote?.ok === true;
  const problemLines = quote && !quote.ok && quote.reason === "problems" ? quote.lines.filter((l) => l.problem) : [];

  return (
    <form action={action} className="space-y-8" noValidate>
      <input type="hidden" name="lines" value={JSON.stringify(lines)} />
      <input type="hidden" name="checkoutToken" value={checkoutToken} />
      <input type="hidden" name="expectedTotalMinor" value={ready ? quote.totalMinor : ""} />

      <section aria-labelledby="summary" className={`${card} space-y-4 p-4`}>
        <h2 id="summary" className="text-lg font-bold">
          Your order
        </h2>
        {ready ? (
          <>
            <ul className="divide-y divide-line">
              {quote.lines.map((l) => (
                <li key={l.key} className="flex justify-between gap-4 py-2">
                  <span>
                    {l.quantity} &times; {l.name}
                    {l.modifiers.length > 0 && <span className="block text-sm text-muted">{l.modifiers.map((m) => m.name).join(", ")}</span>}
                  </span>
                  <MoneyCell minor={l.lineTotalMinor ?? 0} />
                </li>
              ))}
            </ul>
            <OrderTotals {...quote} />
          </>
        ) : problemLines.length > 0 ? (
          <div className="space-y-2" role="alert">
            <p className="font-semibold text-bad">Some items cannot be ordered:</p>
            <ul className="list-inside list-disc text-sm">
              {problemLines.map((l) => (
                <li key={l.key}>
                  {l.name ?? "An item"}: {problemText(l.problem!)}
                </li>
              ))}
            </ul>
            <Link href="/cart" className={button.secondary}>
              Fix my cart
            </Link>
          </div>
        ) : (
          <p className="text-muted" role="status">
            {loading ? "Checking prices…" : "We could not price your cart. Go back to your cart and try again."}
          </p>
        )}
      </section>

      <section aria-labelledby="pickup" className="space-y-4">
        <h2 id="pickup" className="text-lg font-bold">
          Pickup
        </h2>
        <p className="text-muted">
          Collect at {address}. Pay now, then show your order code at the counter.
        </p>
        <div>
          <label htmlFor="pickupAt" className={label}>
            Pickup time
          </label>
          <select id="pickupAt" name="pickupAt" className={field} defaultValue={v.pickupAt || days[0].slots[0].value} key={`s${v.pickupAt}`} aria-describedby={fe.pickupAt ? "pickupAt-error" : undefined} aria-invalid={!!fe.pickupAt}>
            {days.map((d) => (
              <optgroup key={d.day} label={d.day}>
                {d.slots.map((s) => (
                  <option key={s.value} value={s.value}>
                    {d.day}, {s.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {fe.pickupAt && (
            <p id="pickupAt-error" className="mt-1 text-sm text-bad" role="alert">
              {fe.pickupAt}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="phone" className={label}>
            Phone number
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            defaultValue={v.phone ?? defaultPhone}
            key={`p${v.phone}`}
            className={field}
            aria-describedby={`phone-help${fe.phone ? " phone-error" : ""}`}
            aria-invalid={!!fe.phone}
            required
          />
          <p id="phone-help" className="mt-1 text-sm text-muted">
            We call only if there is a problem with your order.
          </p>
          {fe.phone && (
            <p id="phone-error" className="mt-1 text-sm text-bad" role="alert">
              {fe.phone}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="notes" className={label}>
            Note for the kitchen <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea id="notes" name="notes" rows={2} maxLength={200} defaultValue={v.notes} key={`n${v.notes}`} className={field} aria-describedby={fe.notes ? "notes-error" : undefined} />
          {fe.notes && (
            <p id="notes-error" className="mt-1 text-sm text-bad" role="alert">
              {fe.notes}
            </p>
          )}
        </div>
      </section>

      {state?.error && (
        <p className="rounded-lg bg-bad-soft p-4 text-bad" role="alert">
          {state.error}
        </p>
      )}

      <div className="space-y-2">
        <PayButton totalMinor={ready ? quote.totalMinor : null} disabled={!ready} />
        <p className="text-sm text-muted">You will pay on the payment provider&apos;s secure page. We never see your card details.</p>
      </div>
    </form>
  );
}

function MoneyCell({ minor }: { minor: number }) {
  const money = useMoney();
  return <span className="shrink-0 tabular-nums">{money(minor)}</span>;
}
