import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireStaff } from "@/auth/customer";
import { Notice } from "@/components/staff/notice";
import { button, card, field, label } from "@/components/ui";
import { loadAdminMenu } from "@/db/menu-admin";
import { valuesFrom } from "@/lib/notice-url";
import { createItemAction } from "../../actions";

export const metadata: Metadata = { title: "New menu item" };

async function NewItem({ searchParams }: { searchParams: PageProps<"/admin/menu/items/new">["searchParams"] }) {
  const params = await searchParams;
  const { ctx } = await requireStaff(["owner", "manager"], "/admin/menu/items/new");
  const categories = await loadAdminMenu(ctx);
  const v = valuesFrom(params);
  const chosen = v.categoryId ?? (typeof params.category === "string" ? params.category : categories[0]?.id);

  if (categories.length === 0) {
    return (
      <p className={`${card} p-5`}>
        Add a category first. <Link href="/admin/menu" className="font-semibold text-brand underline underline-offset-4">Go to the menu</Link>
      </p>
    );
  }
  return (
    <div className="space-y-4">
      <Notice error={params.error} />
      <form action={createItemAction} className={`${card} max-w-xl space-y-4 p-5`}>
        <div>
          <label htmlFor="categoryId" className={label}>
            Category
          </label>
          <select id="categoryId" name="categoryId" defaultValue={chosen} className={field}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="name" className={label}>
            Name
          </label>
          <input id="name" name="name" defaultValue={v.name} required maxLength={120} className={field} />
        </div>
        <div>
          <label htmlFor="description" className={label}>
            Description <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea id="description" name="description" defaultValue={v.description} rows={2} maxLength={500} className={field} />
        </div>
        <div>
          <label htmlFor="price" className={label}>
            Price
          </label>
          <input id="price" name="price" defaultValue={v.price} inputMode="decimal" required className={field} aria-describedby="price-help" />
          <p id="price-help" className="mt-1 text-sm text-muted">
            For example 3500 or 3500.50. Choices such as sizes are added after the item is saved.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="submit" className={button.primary}>
            Add item
          </button>
          <Link href="/admin/menu" className={button.quiet}>
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}

export default function NewItemPage(props: PageProps<"/admin/menu/items/new">) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold leading-tight">New menu item</h1>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-line" role="status" aria-label="Loading" />}>
        <NewItem searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
