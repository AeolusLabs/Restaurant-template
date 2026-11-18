import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireStaff } from "@/auth/customer";
import { Notice } from "@/components/staff/notice";
import { button, card, field, label } from "@/components/ui";
import { listCustomers, type CustomerSort } from "@/db/customers";
import { dateTime, money } from "@/lib/format";

export const metadata: Metadata = { title: "Customers" };

const SORTS: { value: CustomerSort; label: string }[] = [
  { value: "recent", label: "Ordered most recently" },
  { value: "spend", label: "Spent the most" },
  { value: "orders", label: "Most orders" },
  { value: "joined", label: "Joined most recently" },
];
const LIMIT = 100;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

async function Customers({ searchParams }: { searchParams: PageProps<"/admin/customers">["searchParams"] }) {
  const params = await searchParams;
  const { ctx } = await requireStaff(["owner", "manager"], "/admin/customers");
  const q = one(params.q).slice(0, 100);
  const sort = SORTS.find((s) => s.value === one(params.sort))?.value ?? "recent";
  const customers = await listCustomers(ctx, { search: q, sort, limit: LIMIT });

  return (
    <div className="space-y-6">
      <Notice notice={params.notice} error={params.error} />
      <form method="get" className={`${card} flex flex-wrap items-end gap-3 p-4`}>
        <div className="min-w-48 flex-1">
          <label htmlFor="q" className={label}>
            Search by name, email or phone
          </label>
          <input id="q" name="q" defaultValue={q} maxLength={100} className={field} />
        </div>
        <div>
          <label htmlFor="sort" className={label}>
            Order by
          </label>
          <select id="sort" name="sort" defaultValue={sort} className={field}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={button.primary}>
          Search
        </button>
      </form>

      <p className="text-sm text-muted" role="status">
        {customers.length === 0 ? "No customers found." : `Showing ${customers.length} ${customers.length === 1 ? "customer" : "customers"}${customers.length === LIMIT ? `, the first ${LIMIT}. Search to narrow it down` : ""}.`}
      </p>

      <ul className="space-y-3">
        {customers.map((c) => (
          <li key={c.id}>
            <Link href={`/admin/customers/${c.id}`} className={`${card} block space-y-1 p-4 hover:bg-brand-soft`}>
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-lg font-bold">{c.name}</span>
                {c.blocked && <span className="rounded-full border border-bad bg-bad-soft px-3 py-1 text-sm font-semibold">Blocked</span>}
              </span>
              <span className="block text-sm text-muted">
                {c.email}
                {c.phone ? ` · ${c.phone}` : ""}
              </span>
              <span className="block text-sm">
                {c.orders} {c.orders === 1 ? "order" : "orders"} · {money(c.spentMinor)} spent
                {c.lastOrderAt ? ` · last ordered ${dateTime(c.lastOrderAt)}` : " · has not ordered yet"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function CustomersPage(props: PageProps<"/admin/customers">) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold leading-tight">Customers</h1>
      <Suspense fallback={<div className="h-40 animate-pulse rounded-xl bg-line" role="status" aria-label="Loading customers" />}>
        <Customers searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
