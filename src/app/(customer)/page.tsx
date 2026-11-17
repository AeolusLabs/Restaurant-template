import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { restaurantConfig as c } from "../../../config/restaurant";
import { CartBar } from "@/components/cart/cart-link";
import { QuickAdd } from "@/components/cart/quick-add";
import { button } from "@/components/ui";
import { loadMenu, type MenuItem } from "@/db/menu";
import { openStatus } from "@/domain/hours";
import { money } from "@/lib/format";

async function Intro() {
  await connection(); // opening hours depend on the current time, so this renders per request
  const status = openStatus(new Date(), c);
  return (
    <div className="mb-6 space-y-1">
      <h1 className="text-2xl font-bold leading-tight">Menu</h1>
      <p className="text-muted">
        <span className="font-semibold text-ink">
          <span aria-hidden="true">{status.open ? "● " : "○ "}</span>
          {status.label}
        </span>
        {c.features.pickup && " · Order for pickup"}
      </p>
    </div>
  );
}

function ItemRow({ item }: { item: MenuItem }) {
  const hasChoices = item.groups.length > 0;
  return (
    <li className="flex items-start justify-between gap-4 py-4">
      <div className="min-w-0 flex-1">
        <h3 className="text-base font-semibold">
          <Link href={`/menu/${item.slug}`} className="underline-offset-4 hover:underline">
            {item.name}
          </Link>
        </h3>
        {item.description && <p className="mt-0.5 max-w-prose text-sm text-muted">{item.description}</p>}
        <p className="mt-1 font-semibold">
          {hasChoices && <span className="mr-1 text-sm font-normal text-muted">From</span>}
          {money(item.priceMinor)}
        </p>
      </div>
      <div className="shrink-0 pt-1">
        {!item.available ? (
          <span className="inline-flex min-h-11 items-center rounded-lg bg-warn-soft px-3 text-sm font-semibold text-warn">Sold out</span>
        ) : hasChoices ? (
          <Link href={`/menu/${item.slug}`} className={button.secondary} aria-label={`Choose options for ${item.name}`}>
            Choose
          </Link>
        ) : (
          <QuickAdd itemId={item.id} name={item.name} />
        )}
      </div>
    </li>
  );
}

async function Menu() {
  const menu = await loadMenu();
  if (menu.length === 0) {
    return <p className="rounded-xl border border-line bg-surface p-6 text-muted">The menu is empty at the moment. Please check back soon.</p>;
  }
  return (
    <>
      <nav aria-label="Menu sections" className="mb-6">
        <ul className="flex flex-wrap gap-2">
          {menu.map((cat) => (
            <li key={cat.id}>
              <a
                href={`#cat-${cat.slug}`}
                className="inline-flex min-h-11 items-center rounded-full border border-line-strong bg-surface px-4 text-base font-semibold hover:bg-brand-soft"
              >
                {cat.name}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="space-y-10">
        {menu.map((cat) => (
          <section key={cat.id} aria-labelledby={`cat-${cat.slug}`} className="scroll-mt-4">
            <h2 id={`cat-${cat.slug}`} className="border-b border-line pb-2 text-xl font-bold">
              {cat.name}
            </h2>
            <ul className="divide-y divide-line">
              {cat.items.map((item) => (
                <ItemRow key={item.id} item={item} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}

function MenuSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading the menu">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-20 animate-pulse rounded-xl bg-line" />
      ))}
    </div>
  );
}

export default function MenuPage() {
  return (
    <>
      <Suspense fallback={<div className="mb-6 h-14" />}>
        <Intro />
      </Suspense>
      <Suspense fallback={<MenuSkeleton />}>
        <Menu />
      </Suspense>
      <CartBar />
    </>
  );
}
