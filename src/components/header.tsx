import Link from "next/link";
import { Suspense } from "react";
import { restaurantConfig } from "../../config/restaurant";
import { getIdentity } from "@/auth/customer";
import { CartLink } from "./cart/cart-link";

const nav = "inline-flex min-h-11 items-center rounded-lg px-3 text-base font-semibold text-ink hover:bg-brand-soft";

/** Sign in, or the account link, once the session has been read. */
async function AccountLink() {
  const identity = await getIdentity();
  return identity ? (
    <Link href="/account" className={nav}>
      Account
    </Link>
  ) : (
    <Link href="/sign-in" className={nav}>
      Sign in
    </Link>
  );
}

export function Header() {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
        <Link href="/" className="min-h-11 py-2 text-lg font-bold leading-tight text-ink">
          {restaurantConfig.name}
        </Link>
        <CartLink />
        <nav aria-label="Main" className="-ml-3 flex basis-full flex-wrap items-center gap-1">
          <Link href="/" className={nav}>
            Menu
          </Link>
          <Link href="/orders" className={nav}>
            My orders
          </Link>
          <Suspense
            fallback={
              <span className={`${nav} text-muted`} aria-hidden="true">
                Account
              </span>
            }
          >
            <AccountLink />
          </Suspense>
        </nav>
      </div>
    </header>
  );
}
