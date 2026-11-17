"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { useMoney } from "@/components/money-context";
import { button, card } from "@/components/ui";
import type { PricingGroup } from "@/domain/pricing/price-cart";
import { QuantityStepper } from "./quantity-stepper";
import { useCart } from "./store";

type Props = { itemId: string; name: string; priceMinor: number; groups: PricingGroup[] };

/**
 * Choices for an item (size, extras) with a live price. The price shown here is a convenience: the server
 * prices the real order from the database and refuses it if the total no longer matches what was shown.
 */
export function ItemForm({ itemId, name, priceMinor, groups }: Props) {
  const money = useMoney();
  const { add } = useCart();
  const formId = useId();
  const [picked, setPicked] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(
      groups.map((g) => {
        // A required single choice starts on its first available option, so the common case is one tap.
        const first = g.minSelect === 1 && g.maxSelect === 1 ? g.modifiers.find((m) => m.available) : undefined;
        return [g.id, first ? [first.id] : []];
      }),
    ),
  );
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);

  const chosen = useMemo(() => groups.flatMap((g) => g.modifiers.filter((m) => picked[g.id]?.includes(m.id))), [groups, picked]);
  const unit = chosen.reduce((sum, m) => sum + m.priceDeltaMinor, priceMinor);
  const problems = groups.flatMap((g) => {
    const n = picked[g.id]?.length ?? 0;
    if (n < g.minSelect) return [`Choose ${g.minSelect === 1 ? "one" : g.minSelect} for ${g.name}`];
    return [];
  });

  const toggle = (g: PricingGroup, id: string) =>
    setPicked((p) => {
      const current = p[g.id] ?? [];
      if (g.maxSelect === 1) return { ...p, [g.id]: [id] };
      if (current.includes(id)) return { ...p, [g.id]: current.filter((x) => x !== id) };
      if (current.length >= g.maxSelect) return p;
      return { ...p, [g.id]: [...current, id] };
    });

  if (added) {
    return (
      <div className={`${card} space-y-4 p-4`} role="status">
        <p className="text-lg font-semibold">
          {quantity} &times; {name} added to your cart.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/cart" className={button.primary}>
            View cart
          </Link>
          <Link href="/" className={button.secondary}>
            Keep browsing
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (problems.length > 0) return;
        add({ itemId, modifierIds: chosen.map((m) => m.id), quantity });
        setAdded(true);
      }}
    >
      {groups.map((g) => {
        const single = g.maxSelect === 1;
        const count = picked[g.id]?.length ?? 0;
        return (
          <fieldset key={g.id} className="space-y-2">
            <legend className="mb-1 text-lg font-semibold">
              {g.name}
              <span className="ml-2 text-sm font-normal text-muted">
                {g.minSelect >= 1 ? "Required" : "Optional"}
                {!single && `, up to ${g.maxSelect}`}
              </span>
            </legend>
            {g.modifiers.map((m) => {
              const id = `${formId}-${m.id}`;
              const checked = picked[g.id]?.includes(m.id) ?? false;
              const blocked = !m.available || (!single && !checked && count >= g.maxSelect);
              return (
                <label
                  key={m.id}
                  htmlFor={id}
                  className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 ${checked ? "border-brand bg-brand-soft" : "border-line bg-surface"} ${blocked ? "cursor-not-allowed opacity-55" : ""}`}
                >
                  <input
                    id={id}
                    type={single ? "radio" : "checkbox"}
                    name={`${formId}-${g.id}`}
                    checked={checked}
                    disabled={blocked}
                    onChange={() => toggle(g, m.id)}
                    className="h-5 w-5 accent-[var(--brand)]"
                  />
                  <span className="flex-1">
                    {m.name}
                    {!m.available && <span className="ml-2 text-sm text-muted">Sold out</span>}
                  </span>
                  {m.priceDeltaMinor !== 0 && <span className="text-sm text-muted">+{money(m.priceDeltaMinor)}</span>}
                </label>
              );
            })}
          </fieldset>
        );
      })}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <QuantityStepper quantity={quantity} onChange={setQuantity} label={name} />
        <button type="submit" className={button.primary} disabled={problems.length > 0}>
          Add to cart &middot; {money(unit * quantity)}
        </button>
      </div>
      {problems.length > 0 && (
        <p className="text-sm text-bad" role="alert">
          {problems[0]}
        </p>
      )}
    </form>
  );
}
