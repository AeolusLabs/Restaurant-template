"use client";

import { MAX_LINE_QUANTITY } from "@/domain/pricing/price-cart";

type Props = {
  quantity: number;
  onChange: (quantity: number) => void;
  /** Names the thing being counted, for screen readers: "Burger". */
  label: string;
  /** Lets quantity reach 0 (removing the line) instead of stopping at 1. */
  allowZero?: boolean;
};

const step =
  "inline-flex h-11 w-11 items-center justify-center rounded-lg border border-line-strong bg-surface text-lg font-semibold " +
  "hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-40";

/** A minus, a count and a plus, each at least 44px. The count is announced when it changes. */
export function QuantityStepper({ quantity, onChange, label, allowZero = false }: Props) {
  const min = allowZero ? 0 : 1;
  return (
    <div className="inline-flex items-center gap-1" role="group" aria-label={`Quantity of ${label}`}>
      <button type="button" className={step} onClick={() => onChange(quantity - 1)} disabled={quantity <= min} aria-label={`Fewer ${label}`}>
        <span aria-hidden="true">&minus;</span>
      </button>
      <output className="min-w-8 text-center text-base font-semibold tabular-nums" aria-live="polite">
        {quantity}
      </output>
      <button type="button" className={step} onClick={() => onChange(quantity + 1)} disabled={quantity >= MAX_LINE_QUANTITY} aria-label={`More ${label}`}>
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}
