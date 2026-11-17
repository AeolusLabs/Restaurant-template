"use client";

import Link from "next/link";
import { useMoney } from "@/components/money-context";
import { button, card } from "@/components/ui";
import { problemText } from "./problems";
import { QuantityStepper } from "./quantity-stepper";
import { useCart } from "./store";
import { OrderTotals } from "./totals";
import { useQuote } from "./use-quote";

export function CartView() {
  const money = useMoney();
  const { lines, setQuantity, remove } = useCart();
  const { quote, loading, failed } = useQuote(lines);

  if (lines.length === 0) {
    return (
      <div className={`${card} space-y-4 p-6`}>
        <p className="text-lg font-semibold">Your cart is empty.</p>
        <p className="text-muted">Pick something from the menu and it will appear here.</p>
        <Link href="/" className={button.primary}>
          See the menu
        </Link>
      </div>
    );
  }
  if (failed) {
    return (
      <p className="rounded-lg bg-bad-soft p-4 text-bad" role="alert">
        We could not load your cart prices. Check your connection and refresh the page.
      </p>
    );
  }
  if (!quote) return <p className="text-muted" role="status">Loading your cart&hellip;</p>;
  if (!quote.ok && quote.reason !== "problems") {
    return <p className="rounded-lg bg-bad-soft p-4 text-bad" role="alert">Something in your cart is not valid. Please empty it and start again.</p>;
  }

  const rows = quote.ok || quote.reason === "problems" ? quote.lines : [];
  const blocked = !quote.ok;

  return (
    <div className="space-y-6" aria-busy={loading}>
      <ul className="divide-y divide-line">
        {rows.map((line) => (
          <li key={line.key} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 py-4">
            <div className="min-w-0 flex-1 basis-48">
              <p className="font-semibold">{line.name ?? "Item no longer available"}</p>
              {line.modifiers.length > 0 && <p className="text-sm text-muted">{line.modifiers.map((m) => m.name).join(", ")}</p>}
              {line.problem ? (
                <p className="mt-1 text-sm font-semibold text-bad" role="alert">
                  <span aria-hidden="true">&#9888; </span>
                  {problemText(line.problem)}
                </p>
              ) : (
                <p className="text-sm text-muted">{money(line.unitPriceMinor ?? 0)} each</p>
              )}
            </div>
            <div className="flex items-center gap-3">
              {line.problem ? (
                <button type="button" className={button.danger} onClick={() => remove(line.key)}>
                  Remove
                </button>
              ) : (
                <>
                  <QuantityStepper quantity={line.quantity} label={line.name ?? "item"} allowZero onChange={(q) => setQuantity(line.key, q)} />
                  <span className="w-24 text-right font-semibold tabular-nums">{money(line.lineTotalMinor ?? 0)}</span>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>

      {quote.ok && (
        <div className={`${card} p-4`}>
          <OrderTotals {...quote} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {blocked ? (
          <button type="button" className={button.primary} disabled>
            Continue to checkout
          </button>
        ) : (
          <Link href="/checkout" className={button.primary}>
            Continue to checkout
          </Link>
        )}
        <Link href="/" className={button.quiet}>
          Add more items
        </Link>
      </div>
    </div>
  );
}
