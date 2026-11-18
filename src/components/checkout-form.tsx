"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { placeOrderAction } from "@/app/(customer)/checkout/actions";
import { useMoney } from "@/components/money-context";
import { problemText } from "@/components/cart/problems";
import { useCart } from "@/components/cart/store";
import { OrderTotals } from "@/components/cart/totals";
import { useQuote } from "@/components/cart/use-quote";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { button, card, field, label } from "@/components/ui";

type Props = {
  days: { day: string; slots: { value: string; label: string }[] }[];
  /** Delivery zones on offer right now. Empty when delivery is off or we are closed. */
  zones: { name: string; feeMinor: number }[];
  defaultPhone: string;
  checkoutToken: string;
  address: string;
  /** Whether promo codes are on, so the code field is shown. */
  promosEnabled: boolean;
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

const choice =
  "flex min-h-11 flex-1 cursor-pointer items-center gap-3 rounded-lg border border-line-strong bg-surface px-4 py-2 font-semibold " +
  "has-[:checked]:border-brand has-[:checked]:bg-brand-soft has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand";

export function CheckoutForm({ days, zones, defaultPhone, checkoutToken, address, promosEnabled }: Props) {
  const { lines } = useCart();
  const [state, action] = useActionState(placeOrderAction, undefined);
  const fe = state?.fieldErrors ?? {};
  const v = state?.values ?? {};
  const canPickUp = days.length > 0;
  const canDeliver = zones.length > 0;
  const [fulfilment, setFulfilment] = useState<"pickup" | "delivery">(canPickUp ? "pickup" : "delivery");
  const [zone, setZone] = useState("");
  const delivering = fulfilment === "delivery";
  // What the customer has typed, and the code they asked us to apply. The server prices the applied one.
  const [promoText, setPromoText] = useState("");
  const [appliedCode, setAppliedCode] = useState("");
  const { quote, loading } = useQuote(lines, { zone: delivering && zone ? zone : undefined, fulfilment, promoCode: promosEnabled && appliedCode ? appliedCode : undefined });
  const money = useMoney();

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

  // The price is only trusted once the server has priced it for the choice on screen: a delivery order needs a
  // zone, and an answer for a different zone is out of date.
  const ready = quote?.ok === true && (delivering ? zone !== "" && quote.deliveryZone === zone : quote.deliveryZone === null);
  const problemLines = quote && !quote.ok && quote.reason === "problems" ? quote.lines.filter((l) => l.problem) : [];

  return (
    <form action={action} className="space-y-8" noValidate>
      <input type="hidden" name="lines" value={JSON.stringify(lines)} />
      <input type="hidden" name="checkoutToken" value={checkoutToken} />
      <input type="hidden" name="fulfilment" value={fulfilment} />
      <input type="hidden" name="promoCode" value={quote?.ok && quote.promo ? quote.promo.code : ""} />
      <input type="hidden" name="expectedTotalMinor" value={ready ? quote.totalMinor : ""} />

      <section aria-labelledby="summary" className={`${card} space-y-4 p-4`}>
        <h2 id="summary" className="text-lg font-bold">
          Your order
        </h2>
        {quote?.ok ? (
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
            <OrderTotals {...quote} promoCode={quote.promo?.code} freeDelivery={quote.deliveryWaivedMinor > 0} />
            {delivering && zone === "" && (
              <p className="text-sm text-muted" role="status">
                Choose your area below to see the delivery fee.
              </p>
            )}
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

      {canPickUp && canDeliver && (
        <fieldset className="space-y-2">
          <legend className="mb-1 text-lg font-bold">How would you like your order?</legend>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className={choice}>
              <input type="radio" name="fulfilmentChoice" checked={!delivering} onChange={() => setFulfilment("pickup")} />
              Pickup
            </label>
            <label className={choice}>
              <input type="radio" name="fulfilmentChoice" checked={delivering} onChange={() => setFulfilment("delivery")} />
              Delivery
            </label>
          </div>
        </fieldset>
      )}

      {delivering ? (
        <section aria-labelledby="delivery" className="space-y-4">
          <h2 id="delivery" className="text-lg font-bold">
            Delivery
          </h2>
          <p className="text-muted">A rider brings your order as soon as it is ready. Pay now, then follow your delivery from your order page.</p>
          <div>
            <label htmlFor="zone" className={label}>
              Area
            </label>
            <select
              id="zone"
              name="zone"
              className={field}
              value={zone}
              onChange={(e) => setZone(e.target.value)}
              aria-describedby={fe.zone ? "zone-error" : undefined}
              aria-invalid={!!fe.zone}
              required
            >
              <option value="">Choose your area</option>
              {zones.map((z) => (
                <option key={z.name} value={z.name}>
                  {z.name} ({money(z.feeMinor)})
                </option>
              ))}
            </select>
            {fe.zone && (
              <p id="zone-error" className="mt-1 text-sm text-bad" role="alert">
                {fe.zone}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="address" className={label}>
              Delivery address
            </label>
            <textarea
              id="address"
              name="address"
              rows={2}
              maxLength={200}
              autoComplete="street-address"
              defaultValue={v.address}
              key={`a${v.address}`}
              className={field}
              aria-describedby={fe.address ? "address-error" : undefined}
              aria-invalid={!!fe.address}
              required
            />
            {fe.address && (
              <p id="address-error" className="mt-1 text-sm text-bad" role="alert">
                {fe.address}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="landmark" className={label}>
              Landmark <span className="font-normal text-muted">(optional)</span>
            </label>
            <input id="landmark" name="landmark" maxLength={100} defaultValue={v.landmark} key={`l${v.landmark}`} className={field} aria-describedby={fe.landmark ? "landmark-error" : undefined} />
            {fe.landmark && (
              <p id="landmark-error" className="mt-1 text-sm text-bad" role="alert">
                {fe.landmark}
              </p>
            )}
          </div>
        </section>
      ) : (
        <section aria-labelledby="pickup" className="space-y-4">
          <h2 id="pickup" className="text-lg font-bold">
            Pickup
          </h2>
          <p className="text-muted">Collect at {address}. Pay now, then show your order code at the counter.</p>
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
        </section>
      )}

      {promosEnabled && (
        <section aria-labelledby="promo-h" className="space-y-2">
          <h2 id="promo-h" className="text-lg font-bold">
            Promo code <span className="font-normal text-muted">(optional)</span>
          </h2>
          <div className="flex gap-2">
            <input
              id="promo"
              aria-label="Promo code"
              value={promoText}
              onChange={(e) => setPromoText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  setAppliedCode(promoText.trim());
                }
              }}
              maxLength={40}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              className={field}
              aria-describedby="promo-status"
            />
            <button type="button" className={button.secondary} onClick={() => setAppliedCode(promoText.trim())} disabled={promoText.trim() === ""}>
              Apply
            </button>
          </div>
          <div id="promo-status" aria-live="polite" className="text-sm">
            {quote?.ok && quote.promo && (
              <p className="text-ok">
                Code {quote.promo.code} applied
                {quote.deliveryWaivedMinor > 0 ? ": delivery is free." : `: you save ${money(quote.discountMinor)}.`}{" "}
                <button
                  type="button"
                  className="font-semibold underline underline-offset-4"
                  onClick={() => {
                    setAppliedCode("");
                    setPromoText("");
                  }}
                >
                  Remove
                </button>
              </p>
            )}
            {quote?.ok && quote.promoError && <p className="text-bad">{quote.promoError}</p>}
            {fe.promoCode && (
              <p className="text-bad" role="alert">
                {fe.promoCode}
              </p>
            )}
          </div>
        </section>
      )}

      <section aria-labelledby="details" className="space-y-4">
        <h2 id="details" className="text-lg font-bold">
          Your details
        </h2>
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
            {delivering ? "The rider calls this number when they arrive." : "We call only if there is a problem with your order."}
          </p>
          {fe.phone && (
            <p id="phone-error" className="mt-1 text-sm text-bad" role="alert">
              {fe.phone}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="notes" className={label}>
            {delivering ? "Note for the kitchen or rider" : "Note for the kitchen"} <span className="font-normal text-muted">(optional)</span>
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

      <TurnstileWidget />
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
