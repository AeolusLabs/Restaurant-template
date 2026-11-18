import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { requireStaff } from "@/auth/customer";
import { Notice } from "@/components/staff/notice";
import { button, card, field, label } from "@/components/ui";
import { getQrSource } from "@/db/qr-admin";
import { loadEnv } from "@/lib/env";
import { money } from "@/lib/format";
import { qrSvg, scanUrl } from "@/lib/qr";
import { renameQrAction, setQrActiveAction } from "../actions";
import { PrintButton } from "../print-button";
import { RANGES, parseRange } from "../range";

export const metadata: Metadata = { title: "QR code" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function Detail({ params, searchParams }: { params: PageProps<"/admin/qr/[id]">["params"]; searchParams: PageProps<"/admin/qr/[id]">["searchParams"] }) {
  await connection();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const query = await searchParams;
  const { ctx } = await requireStaff(["owner", "manager"], `/admin/qr/${id}`);
  const range = parseRange(query.days);
  const s = await getQrSource(ctx, id, range);
  if (!s) notFound();
  const url = scanUrl(loadEnv().APP_URL, s.slug);
  const svg = await qrSvg(url);

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <Notice notice={query.notice} error={query.error} />
      </div>

      <section className={`${card} space-y-4 p-5 text-center print:border-0`} aria-labelledby="print-area">
        <h2 id="print-area" className="text-2xl font-bold">
          {s.label}
        </h2>
        {/* The code is generated here from our own address, never from anything typed into a form. */}
        <div className="mx-auto w-full max-w-sm bg-white p-2 [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} role="img" aria-label={`QR code for ${s.label}`} />
        <p className="break-all text-sm text-muted">{url}</p>
        <div className="flex flex-wrap justify-center gap-2 print:hidden">
          <PrintButton />
          <a href={`/admin/qr/${s.id}/image?format=png`} className={button.secondary} download>
            Download PNG
          </a>
          <a href={`/admin/qr/${s.id}/image?format=svg`} className={button.secondary} download>
            Download SVG
          </a>
        </div>
        {!s.active && <p className="rounded-lg bg-warn-soft p-3 font-semibold print:hidden">This code is switched off. It still opens the menu, but scans are not counted.</p>}
      </section>

      <div className="space-y-6 print:hidden">
        <section className={`${card} space-y-3 p-4`} aria-labelledby="numbers">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="numbers" className="text-lg font-bold">
              How it is doing
            </h2>
            <nav aria-label="Report period" className="flex flex-wrap gap-2">
              {RANGES.map((r) => (
                <Link key={r.value} href={`/admin/qr/${s.id}?days=${r.value}`} aria-current={r.value === String(range) ? "page" : undefined} className={r.value === String(range) ? button.primary : button.secondary}>
                  {r.label}
                </Link>
              ))}
            </nav>
          </div>
          <dl className="grid grid-cols-3 gap-3">
            <div>
              <dt className="text-sm text-muted">Scans</dt>
              <dd className="text-2xl font-bold tabular-nums">{s.scans}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted">Orders</dt>
              <dd className="text-2xl font-bold tabular-nums">{s.orders}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted">Completed sales</dt>
              <dd className="text-2xl font-bold tabular-nums">{money(s.revenueMinor)}</dd>
            </div>
          </dl>
        </section>

        <form action={renameQrAction} className={`${card} flex flex-wrap items-end gap-3 p-4`}>
          <input type="hidden" name="id" value={s.id} />
          <div className="min-w-48 flex-1">
            <label htmlFor="rename" className={label}>
              Name
            </label>
            <input id="rename" name="label" defaultValue={s.label} required maxLength={120} className={field} />
          </div>
          <button type="submit" className={button.secondary}>
            Save name
          </button>
        </form>

        <section className={`${card} space-y-2 p-4`} aria-labelledby="onoff">
          <h2 id="onoff" className="text-lg font-bold">
            {s.active ? "Switch off" : "Switch on"}
          </h2>
          <p className="text-sm text-muted">
            {s.active
              ? "A switched-off code still opens the menu, so printed copies never lead nowhere, but its scans are not counted and orders are not credited to it."
              : "Scans will be counted and orders credited to this code again."}
          </p>
          <form action={setQrActiveAction}>
            <input type="hidden" name="id" value={s.id} />
            <input type="hidden" name="active" value={String(!s.active)} />
            <button type="submit" className={s.active ? button.danger : button.secondary}>
              {s.active ? "Switch off" : "Switch on"}
            </button>
          </form>
        </section>

        <Link href="/admin/qr" className={button.quiet}>
          All QR codes
        </Link>
      </div>
    </div>
  );
}

export default function QrDetailPage(props: PageProps<"/admin/qr/[id]">) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold leading-tight print:hidden">QR code</h1>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-line" role="status" aria-label="Loading" />}>
        <Detail params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
