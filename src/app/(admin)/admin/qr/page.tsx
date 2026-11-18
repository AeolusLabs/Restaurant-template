import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { requireStaff } from "@/auth/customer";
import { Notice } from "@/components/staff/notice";
import { button, card, field, label } from "@/components/ui";
import { listQrSources, type QrRange } from "@/db/qr-admin";
import { money } from "@/lib/format";
import { valuesFrom } from "@/lib/notice-url";
import { createQrAction } from "./actions";
import { RANGES, parseRange } from "./range";

export const metadata: Metadata = { title: "QR codes" };

async function Qr({ searchParams }: { searchParams: PageProps<"/admin/qr">["searchParams"] }) {
  await connection(); // the report window is measured from now
  const params = await searchParams;
  const { ctx } = await requireStaff(["owner", "manager"], "/admin/qr");
  const range: QrRange = parseRange(params.days);
  const sources = await listQrSources(ctx, range);
  const typed = valuesFrom(params);

  return (
    <div className="space-y-6">
      <Notice notice={params.notice} error={params.error} />

      <form action={createQrAction} className={`${card} flex flex-wrap items-end gap-3 p-4`}>
        <div className="min-w-48 flex-1">
          <label htmlFor="label" className={label}>
            New QR code
          </label>
          <input id="label" name="label" defaultValue={typed.label} required maxLength={120} className={field} placeholder="Where will it be? For example: Lekki flyer" aria-describedby="qr-help" />
          <p id="qr-help" className="mt-1 text-sm text-muted">
            Make one for each place you advertise, so you can see which ones bring orders.
          </p>
        </div>
        <button type="submit" className={button.primary}>
          Make QR code
        </button>
      </form>

      <nav aria-label="Report period" className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">Show:</span>
        {RANGES.map((r) => (
          <Link key={r.value} href={`/admin/qr?days=${r.value}`} aria-current={r.value === String(range) ? "page" : undefined} className={r.value === String(range) ? button.primary : button.secondary}>
            {r.label}
          </Link>
        ))}
      </nav>

      {sources.length === 0 && <p className="text-muted">There are no QR codes yet. Make one above.</p>}
      <ul className="space-y-3">
        {sources.map((s) => (
          <li key={s.id}>
            <Link href={`/admin/qr/${s.id}`} className={`${card} block space-y-2 p-4 hover:bg-brand-soft`}>
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-lg font-bold">{s.label}</span>
                {!s.active && <span className="rounded-full border border-warn bg-warn-soft px-3 py-1 text-sm font-semibold">Switched off</span>}
              </span>
              <dl className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <dt className="text-muted">Scans</dt>
                  <dd className="text-xl font-bold tabular-nums">{s.scans}</dd>
                </div>
                <div>
                  <dt className="text-muted">Orders</dt>
                  <dd className="text-xl font-bold tabular-nums">{s.orders}</dd>
                </div>
                <div>
                  <dt className="text-muted">Completed sales</dt>
                  <dd className="text-xl font-bold tabular-nums">{money(s.revenueMinor)}</dd>
                </div>
              </dl>
            </Link>
          </li>
        ))}
      </ul>
      <p className="text-sm text-muted">
        A scan is a visit to the code&apos;s address, so a link preview or a bot can add one. Orders are the real measure. An order is credited to the last code the customer scanned in the 7 days before ordering.
      </p>
    </div>
  );
}

export default function QrPage(props: PageProps<"/admin/qr">) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold leading-tight">QR codes</h1>
      <Suspense fallback={<div className="h-40 animate-pulse rounded-xl bg-line" role="status" aria-label="Loading QR codes" />}>
        <Qr searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
