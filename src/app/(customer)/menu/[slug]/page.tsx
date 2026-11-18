import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CartBar } from "@/components/cart/cart-link";
import { ItemForm } from "@/components/cart/item-form";
import { QuickAdd } from "@/components/cart/quick-add";
import { button } from "@/components/ui";
import { loadMenuItem } from "@/db/menu";
import { money } from "@/lib/format";

export const metadata: Metadata = { title: "Menu item" };

async function Item({ params }: { params: PageProps<"/menu/[slug]">["params"] }) {
  const { slug } = await params;
  const found = await loadMenuItem(slug);
  if (!found) notFound();
  const { item, categoryName } = found;

  return (
    <article className="space-y-6">
      {item.imageKey && <Image src={`/api/media/${item.imageKey}`} alt="" width={640} height={360} unoptimized className="max-h-64 w-full rounded-xl object-cover" />}
      <div>
        <p className="text-sm font-semibold text-muted">{categoryName}</p>
        <h1 className="text-2xl font-bold leading-tight">{item.name}</h1>
        {item.description && <p className="mt-2 max-w-prose text-muted">{item.description}</p>}
        <p className="mt-2 text-lg font-semibold">
          {item.groups.length > 0 && <span className="mr-1 text-sm font-normal text-muted">From</span>}
          {money(item.priceMinor)}
        </p>
      </div>

      {!item.available ? (
        <p className="rounded-lg bg-warn-soft p-4 font-semibold text-warn" role="status">
          This item is sold out for now.
        </p>
      ) : item.groups.length > 0 ? (
        <ItemForm itemId={item.id} name={item.name} priceMinor={item.priceMinor} groups={item.groups} />
      ) : (
        <QuickAdd itemId={item.id} name={item.name} />
      )}

      <Link href="/" className={button.quiet}>
        Back to the menu
      </Link>
    </article>
  );
}

export default function ItemPage({ params }: PageProps<"/menu/[slug]">) {
  return (
    <>
      <Suspense fallback={<div className="h-40 animate-pulse rounded-xl bg-line" role="status" aria-label="Loading the item" />}>
        <Item params={params} />
      </Suspense>
      <CartBar />
    </>
  );
}
