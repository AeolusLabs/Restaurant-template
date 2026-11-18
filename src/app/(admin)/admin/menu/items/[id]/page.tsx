import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { restaurantConfig } from "../../../../../../../config/restaurant";
import { requireStaff } from "@/auth/customer";
import { Notice } from "@/components/staff/notice";
import { button, card, field, label } from "@/components/ui";
import { loadAdminMenu } from "@/db/menu-admin";
import { groupProblem } from "@/domain/menu/rules";
import { moneyInputValue } from "@/lib/money";
import { valuesFrom } from "@/lib/notice-url";
import {
  createGroupAction,
  createModifierAction,
  deleteGroupAction,
  deleteModifierAction,
  removeImageAction,
  updateGroupAction,
  updateItemAction,
  updateModifierAction,
  uploadImageAction,
} from "../../actions";

export const metadata: Metadata = { title: "Edit menu item" };

const exponent = restaurantConfig.currency.exponent;
const row = "flex flex-wrap items-end gap-3";
const mini = "min-h-11 w-full rounded-lg border border-line-strong bg-surface px-3 py-2";

async function Editor({ params, searchParams }: { params: PageProps<"/admin/menu/items/[id]">["params"]; searchParams: PageProps<"/admin/menu/items/[id]">["searchParams"] }) {
  const { id } = await params;
  const sp = await searchParams;
  const { notice, error } = sp;
  // After a refused save the form shows what was typed; otherwise what is stored.
  const v = valuesFrom(sp);
  const edited = "name" in v;
  const { ctx } = await requireStaff(["owner", "manager"], `/admin/menu/items/${id}`);
  const categories = await loadAdminMenu(ctx);
  const item = categories.flatMap((c) => c.items).find((i) => i.id === id);
  if (!item) notFound();

  return (
    <div className="space-y-8">
      <Notice notice={notice} error={error} />

      <form action={updateItemAction} className={`${card} max-w-xl space-y-4 p-5`} aria-label="Item details">
        <input type="hidden" name="id" value={item.id} />
        <div>
          <label htmlFor="name" className={label}>
            Name
          </label>
          <input id="name" name="name" defaultValue={v.name ?? item.name} required maxLength={120} className={field} />
        </div>
        <div>
          <label htmlFor="description" className={label}>
            Description
          </label>
          <textarea id="description" name="description" defaultValue={v.description ?? item.description ?? ""} rows={2} maxLength={500} className={field} />
        </div>
        <div>
          <label htmlFor="price" className={label}>
            Price
          </label>
          <input id="price" name="price" defaultValue={v.price ?? moneyInputValue(item.priceMinor, exponent)} inputMode="decimal" required className={field} />
        </div>
        <div>
          <label htmlFor="categoryId" className={label}>
            Category
          </label>
          <select id="categoryId" name="categoryId" defaultValue={v.categoryId ?? item.categoryId} className={field}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <label className="flex min-h-11 items-center gap-3">
          <input type="checkbox" name="available" defaultChecked={edited ? v.available === "on" : item.available} className="h-5 w-5 accent-[var(--brand)]" />
          <span>In stock (untick to show it as sold out)</span>
        </label>
        <label className="flex min-h-11 items-center gap-3">
          <input type="checkbox" name="active" defaultChecked={edited ? v.active === "on" : item.active} className="h-5 w-5 accent-[var(--brand)]" />
          <span>Shown on the menu (untick to archive it)</span>
        </label>
        <div className="flex flex-wrap gap-3">
          <button type="submit" className={button.primary}>
            Save details
          </button>
          <Link href="/admin/menu" className={button.quiet}>
            Back to the menu
          </Link>
        </div>
      </form>

      <section className={`${card} max-w-xl space-y-4 p-5`} aria-labelledby="photo">
        <h2 id="photo" className="text-lg font-bold">
          Photo
        </h2>
        {item.imageKey ? (
          <Image src={`/api/media/${item.imageKey}`} alt={`${item.name}`} width={320} height={200} unoptimized className="max-h-48 w-auto rounded-lg object-cover" />
        ) : (
          <p className="text-muted">No photo yet.</p>
        )}
        <form action={uploadImageAction} className={row}>
          <input type="hidden" name="id" value={item.id} />
          <div className="min-w-48 flex-1">
            <label htmlFor="image" className={label}>
              {item.imageKey ? "Replace the photo" : "Add a photo"} (JPEG, PNG or WebP, under 2 MB)
            </label>
            <input id="image" name="image" type="file" accept="image/jpeg,image/png,image/webp" required className={mini} />
          </div>
          <button type="submit" className={button.secondary}>
            Upload
          </button>
        </form>
        {item.imageKey && (
          <form action={removeImageAction}>
            <input type="hidden" name="id" value={item.id} />
            <button type="submit" className={button.quiet}>
              Remove the photo
            </button>
          </form>
        )}
      </section>

      <section className="space-y-4" aria-labelledby="choices">
        <div>
          <h2 id="choices" className="text-lg font-bold">
            Choices
          </h2>
          <p className="text-sm text-muted">For things like size or extras. &ldquo;Fewest&rdquo; 1 makes a choice required; 0 makes it optional.</p>
        </div>

        {item.groups.map((g) => {
          const problem = groupProblem(g);
          return (
            <article key={g.id} className={`${card} space-y-4 p-4`} aria-label={`Choice group ${g.name}`}>
              {problem && (
                <p className="rounded-lg bg-bad-soft p-3 text-sm font-semibold text-bad" role="alert">
                  <span aria-hidden="true">&#9888; </span>
                  {problem}
                </p>
              )}
              <form action={updateGroupAction} className={row}>
                <input type="hidden" name="id" value={g.id} />
                <input type="hidden" name="itemId" value={item.id} />
                <div className="min-w-40 flex-1">
                  <label htmlFor={`gn-${g.id}`} className={label}>
                    Group name
                  </label>
                  <input id={`gn-${g.id}`} name="name" defaultValue={g.name} required maxLength={120} className={mini} />
                </div>
                <div className="w-28">
                  <label htmlFor={`gmin-${g.id}`} className={label}>
                    Fewest
                  </label>
                  <input id={`gmin-${g.id}`} name="min" type="number" min={0} max={50} defaultValue={g.minSelect} className={mini} />
                </div>
                <div className="w-28">
                  <label htmlFor={`gmax-${g.id}`} className={label}>
                    Most
                  </label>
                  <input id={`gmax-${g.id}`} name="max" type="number" min={1} max={50} defaultValue={g.maxSelect} className={mini} />
                </div>
                <button type="submit" className={button.secondary}>
                  Save group
                </button>
              </form>

              <ul className="space-y-3">
                {g.modifiers.map((m) => (
                  <li key={m.id}>
                    <form action={updateModifierAction} className={row}>
                      <input type="hidden" name="id" value={m.id} />
                      <input type="hidden" name="itemId" value={item.id} />
                      <div className="min-w-36 flex-1">
                        <label htmlFor={`mn-${m.id}`} className="sr-only">
                          Choice name
                        </label>
                        <input id={`mn-${m.id}`} name="name" defaultValue={m.name} required maxLength={120} className={mini} />
                      </div>
                      <div className="w-32">
                        <label htmlFor={`mp-${m.id}`} className="sr-only">
                          Extra price for {m.name}
                        </label>
                        <input id={`mp-${m.id}`} name="price" defaultValue={moneyInputValue(m.priceDeltaMinor, exponent)} inputMode="decimal" className={mini} />
                      </div>
                      <label className="flex min-h-11 items-center gap-2">
                        <input type="checkbox" name="available" defaultChecked={m.available} className="h-5 w-5 accent-[var(--brand)]" />
                        <span className="text-sm">In stock</span>
                      </label>
                      <button type="submit" className={button.secondary}>
                        Save
                      </button>
                    </form>
                    <form action={deleteModifierAction} className="mt-1">
                      <input type="hidden" name="id" value={m.id} />
                      <input type="hidden" name="itemId" value={item.id} />
                      <button type="submit" className="min-h-11 text-sm font-semibold text-bad underline underline-offset-4">
                        Delete {m.name}
                      </button>
                    </form>
                  </li>
                ))}
              </ul>

              <form action={createModifierAction} className={`${row} border-t border-line pt-4`}>
                <input type="hidden" name="groupId" value={g.id} />
                <input type="hidden" name="itemId" value={item.id} />
                <div className="min-w-36 flex-1">
                  <label htmlFor={`new-mn-${g.id}`} className={label}>
                    New choice
                  </label>
                  <input id={`new-mn-${g.id}`} name="name" required maxLength={120} className={mini} />
                </div>
                <div className="w-32">
                  <label htmlFor={`new-mp-${g.id}`} className={label}>
                    Extra price
                  </label>
                  <input id={`new-mp-${g.id}`} name="price" defaultValue="0" inputMode="decimal" className={mini} />
                </div>
                <button type="submit" className={button.secondary}>
                  Add choice
                </button>
              </form>

              <form action={deleteGroupAction}>
                <input type="hidden" name="id" value={g.id} />
                <input type="hidden" name="itemId" value={item.id} />
                <button type="submit" className={button.danger}>
                  Delete the group &ldquo;{g.name}&rdquo;
                </button>
              </form>
            </article>
          );
        })}

        <form action={createGroupAction} className={`${card} ${row} p-4`} aria-label="Add a choice group">
          <input type="hidden" name="itemId" value={item.id} />
          <div className="min-w-40 flex-1">
            <label htmlFor="ng-name" className={label}>
              New group (for example Size)
            </label>
            <input id="ng-name" name="name" required maxLength={120} className={mini} />
          </div>
          <div className="w-28">
            <label htmlFor="ng-min" className={label}>
              Fewest
            </label>
            <input id="ng-min" name="min" type="number" min={0} max={50} defaultValue={0} className={mini} />
          </div>
          <div className="w-28">
            <label htmlFor="ng-max" className={label}>
              Most
            </label>
            <input id="ng-max" name="max" type="number" min={1} max={50} defaultValue={1} className={mini} />
          </div>
          <button type="submit" className={button.secondary}>
            Add group
          </button>
        </form>
      </section>
    </div>
  );
}

export default function EditItemPage(props: PageProps<"/admin/menu/items/[id]">) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold leading-tight">Edit menu item</h1>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-line" role="status" aria-label="Loading" />}>
        <Editor params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
