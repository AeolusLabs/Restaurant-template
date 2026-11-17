"use client";

import Link from "next/link";
import { useCart } from "./store";

/** The header's cart link, with the number of items. Starts at zero on the server and fills in after load. */
export function CartLink() {
  const { count } = useCart();
  return (
    <Link
      href="/cart"
      className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line-strong bg-surface px-3 text-base font-semibold hover:bg-brand-soft"
      aria-label={count > 0 ? `Cart, ${count} ${count === 1 ? "item" : "items"}` : "Cart, empty"}
    >
      Cart
      {count > 0 && (
        <span className="min-w-6 rounded-full bg-brand px-2 text-center text-sm text-on-brand" aria-hidden="true">
          {count}
        </span>
      )}
    </Link>
  );
}

/** A bar fixed to the bottom of the menu on small screens once something is in the cart. */
export function CartBar() {
  const { count } = useCart();
  if (count === 0) return null;
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:hidden">
      <Link
        href="/cart"
        className="flex min-h-12 w-full items-center justify-between rounded-lg bg-brand px-4 text-base font-semibold text-on-brand"
      >
        <span>View cart</span>
        <span>
          {count} {count === 1 ? "item" : "items"}
        </span>
      </Link>
    </div>
  );
}
