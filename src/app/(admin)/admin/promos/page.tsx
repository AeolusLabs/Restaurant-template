import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { restaurantConfig as c } from "../../../../../config/restaurant";
import { requireStaff } from "@/auth/customer";
import { Notice } from "@/components/staff/notice";
import { button, card } from "@/components/ui";
import { listPromos } from "@/db/promos-admin";
import { describePromo, promoStatus, type PromoStatus } from "@/domain/promos/rules";
import { dateTime, money } from "@/lib/format";
import { setPromoActiveAction } from "./actions";

export const metadata: Metadata = { title: "Promos" };

const BADGE: Record<PromoStatus, { text: string; cls: string }> = {
  live: { text: "Live", cls: "border-ok bg-ok-soft" },
  off: { text: "Switched off", cls: "border-line-strong bg-surface" },
  scheduled: { text: "Not started", cls: "border-warn bg-warn-soft" },
  expired: { text: "Ended", cls: "border-line-strong bg-surface" },
  used_up: { text: "Used up", cls: "border-warn bg-warn-soft" },
};

async function Promos({ searchParams }: { searchParams: PageProps<"/admin/promos">["searchParams"] }) {
  await connection(); // a promo's status depends on the current time
  const params = await searchParams;
  const { ctx } = await requireStaff(["owner", "manager"], "/admin/promos");
  const promos = await listPromos(ctx);
  const now = new Date();

  return (
    <div className="space-y-6">
      <Notice notice={params.notice} error={params.error} />
      {!c.features.promos && (
        <p className="rounded-lg border border-warn bg-warn-soft p-4" role="status">
          Promo codes are switched off for this restaurant (<code>features.promos</code> in the config), so customers cannot use any of these. You can still prepare them here.
        </p>
      )}
      <div>
        <Link href="/admin/promos/new" className={button.primary}>
          New promo
        </Link>
      </div>
      {promos.length === 0 && <p className="text-muted">There are no promos yet.</p>}
      <ul className="space-y-3">
        {promos.map((p) => {
          const status = promoStatus(p, p.redemptions, now);
          const badge = BADGE[status];
          return (
            <li key={p.id} className={`${card} space-y-2 p-4`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xl font-bold tracking-wider">{p.code}</p>
                <span className={`rounded-full border px-3 py-1 text-sm font-semibold ${badge.cls}`}>{badge.text}</span>
              </div>
              <p>{describePromo(p, money)}</p>
              {p.description && <p className="text-sm text-muted">{p.description}</p>}
              <p className="text-sm text-muted">
                Used {p.redemptions}
                {p.maxRedemptions !== null ? ` of ${p.maxRedemptions}` : ""} {p.redemptions === 1 ? "time" : "times"}, taking {money(p.discountGivenMinor)} off in total.
                {p.maxPerCustomer !== null ? ` ${p.maxPerCustomer} per customer.` : " No limit per customer."}
              </p>
              {(p.startsAt || p.expiresAt) && (
                <p className="text-sm text-muted">
                  {p.startsAt ? `From ${dateTime(p.startsAt)}. ` : ""}
                  {p.expiresAt ? `Until ${dateTime(p.expiresAt)}.` : ""}
                </p>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <Link href={`/admin/promos/${p.id}`} className={button.secondary}>
                  Edit
                </Link>
                <form action={setPromoActiveAction}>
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="active" value={String(!p.active)} />
                  <button type="submit" className={p.active ? button.danger : button.secondary}>
                    {p.active ? "Switch off" : "Switch on"}
                  </button>
                </form>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function PromosPage(props: PageProps<"/admin/promos">) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold leading-tight">Promos</h1>
      <Suspense fallback={<div className="h-40 animate-pulse rounded-xl bg-line" role="status" aria-label="Loading promos" />}>
        <Promos searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
