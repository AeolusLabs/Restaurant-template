import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireStaff } from "@/auth/customer";
import { Notice } from "@/components/staff/notice";
import { button, card, field, label } from "@/components/ui";
import { loadAdminMenu } from "@/db/menu-admin";
import { groupProblem } from "@/domain/menu/rules";
import { money } from "@/lib/format";
import { createCategoryAction, moveCategoryAction, moveItemAction, setCategoryActiveAction, setItemAvailableAction } from "./actions";

export const metadata: Metadata = { title: "Menu" };

const small = "inline-flex min-h-11 items-center justify-center rounded-lg border border-line-strong bg-surface px-3 text-sm font-semibold hover:bg-brand-soft";

function Move({ action, id, label: text }: { action: (f: FormData) => Promise<void>; id: string; label: string }) {
  return (
    <span className="inline-flex gap-1">
      {(["up", "down"] as const).map((dir) => (
        <form key={dir} action={action}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="dir" value={dir} />
          <button type="submit" className={`${small} w-11`} aria-label={`Move ${text} ${dir}`}>
            <span aria-hidden="true">{dir === "up" ? "↑" : "↓"}</span>
          </button>
        </form>
      ))}
    </span>
  );
}

async function MenuAdmin({ searchParams }: { searchParams: PageProps<"/admin/menu">["searchParams"] }) {
  const params = await searchParams;
  const { ctx } = await requireStaff(["owner", "manager"], "/admin/menu");
  const categories = await loadAdminMenu(ctx);

  return (
    <div className="space-y-8">
      <Notice notice={params.notice} error={params.error} />

      <form action={createCategoryAction} className={`${card} flex flex-wrap items-end gap-3 p-4`}>
        <div className="min-w-48 flex-1">
          <label htmlFor="cat-name" className={label}>
            New category
          </label>
          <input id="cat-name" name="name" required maxLength={120} className={field} placeholder="For example: Starters" />
        </div>
        <button type="submit" className={button.primary}>
          Add category
        </button>
      </form>

      {categories.length === 0 && <p className="text-muted">There are no categories yet. Add one above, then add items to it.</p>}

      {categories.map((cat) => (
        <section key={cat.id} aria-labelledby={`c-${cat.id}`} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-2">
            <h2 id={`c-${cat.id}`} className="text-xl font-bold">
              {cat.name}
              {!cat.active && <span className="ml-2 rounded-full border border-warn bg-warn-soft px-2 py-0.5 text-sm font-semibold">Hidden</span>}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <Move action={moveCategoryAction} id={cat.id} label={cat.name} />
              <form action={setCategoryActiveAction}>
                <input type="hidden" name="id" value={cat.id} />
                <input type="hidden" name="active" value={String(!cat.active)} />
                <button type="submit" className={small}>
                  {cat.active ? "Hide category" : "Show category"}
                </button>
              </form>
              <Link href={`/admin/menu/items/new?category=${cat.id}`} className={small}>
                Add item
              </Link>
            </div>
          </div>
          {!cat.active && cat.items.length > 0 && <p className="text-sm text-warn">This category is hidden, so its {cat.items.length} items are hidden from customers too.</p>}
          {cat.items.length === 0 && <p className="text-muted">No items yet.</p>}
          <ul className="space-y-2">
            {cat.items.map((item) => {
              const problem = item.groups.map(groupProblem).find(Boolean);
              return (
                <li key={item.id} className={`${card} flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-3`}>
                  <div className="min-w-0 flex-1 basis-48">
                    <Link href={`/admin/menu/items/${item.id}`} className="font-semibold underline-offset-4 hover:underline">
                      {item.name}
                    </Link>
                    <p className="text-sm text-muted">
                      {money(item.priceMinor)}
                      {!item.available && " · Sold out"}
                      {!item.active && " · Archived"}
                    </p>
                    {problem && (
                      <p className="mt-1 text-sm font-semibold text-bad">
                        <span aria-hidden="true">&#9888; </span>Customers cannot order this yet. Open it to fix its choices.
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <form action={setItemAvailableAction}>
                      <input type="hidden" name="id" value={item.id} />
                      <input type="hidden" name="available" value={String(!item.available)} />
                      <button type="submit" className={small}>
                        {item.available ? "Mark sold out" : "Back in stock"}
                      </button>
                    </form>
                    <Move action={moveItemAction} id={item.id} label={item.name} />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default function AdminMenuPage(props: PageProps<"/admin/menu">) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold leading-tight">Menu</h1>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-line" role="status" aria-label="Loading the menu" />}>
        <MenuAdmin searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
