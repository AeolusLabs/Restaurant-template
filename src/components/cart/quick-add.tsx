"use client";

import { button } from "@/components/ui";
import { lineKey } from "@/domain/checkout/line-key";
import { QuantityStepper } from "./quantity-stepper";
import { useCart } from "./store";

/** Add button for an item with no choices to make. Once it is in the cart it turns into a quantity stepper. */
export function QuickAdd({ itemId, name }: { itemId: string; name: string }) {
  const { lines, add, setQuantity } = useCart();
  const key = lineKey({ itemId, modifierIds: [] });
  const inCart = lines.find((l) => lineKey(l) === key)?.quantity ?? 0;

  if (inCart > 0) return <QuantityStepper quantity={inCart} label={name} allowZero onChange={(q) => setQuantity(key, q)} />;
  return (
    <button type="button" className={button.secondary} onClick={() => add({ itemId, modifierIds: [], quantity: 1 })} aria-label={`Add ${name} to cart`}>
      Add
    </button>
  );
}
