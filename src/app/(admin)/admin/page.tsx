import Link from "next/link";
import { Suspense } from "react";
import { restaurantConfig as c } from "../../../../config/restaurant";
import { requireStaff } from "@/auth/customer";
import { Notice } from "@/components/staff/notice";
import { button, card } from "@/components/ui";
import { listOpenAlerts } from "@/db/alerts";
import { listOrdersForStaff } from "@/db/staff-orders";
import { latestWalletSnapshot } from "@/db/wallet";
import { alertText } from "@/domain/alerts/text";
import { dateTime, money } from "@/lib/format";
import { resolveAlertAction } from "./actions";

async function Home({ searchParams }: { searchParams: PageProps<"/admin">["searchParams"] }) {
  const params = await searchParams;
  const { ctx, name } = await requireStaff(["owner", "manager"], "/admin");
  const [alerts, waiting, wallet] = await Promise.all([
    listOpenAlerts(ctx),
    listOrdersForStaff(ctx, { statuses: ["paid"], limit: 100 }),
    c.features.delivery ? latestWalletSnapshot(ctx) : null,
  ]);
  const walletLow = wallet !== null && wallet.balanceMinor < c.delivery.lowWalletMinor;

  return (
    <div className="space-y-8">
      <Notice notice={params.notice} error={params.error} />
      <p className="text-muted">Signed in as {name}.</p>

      <section className="space-y-3" aria-labelledby="attention">
        <h2 id="attention" className="text-xl font-bold">
          Needs attention
        </h2>
        {alerts.length === 0 && waiting.length === 0 && <p className={`${card} p-5 text-muted`}>Nothing needs you right now.</p>}

        {waiting.length > 0 && (
          <Link href="/admin/orders?view=needs" className={`${card} flex flex-wrap items-center justify-between gap-3 border-2 border-brand p-4 hover:bg-brand-soft`}>
            <span className="text-lg font-semibold">
              {waiting.length} {waiting.length === 1 ? "order is" : "orders are"} paid and waiting to be accepted
            </span>
            <span className="font-semibold text-brand">See them</span>
          </Link>
        )}

        {alerts.map((a) => (
          <article key={a.id} className="space-y-3 rounded-xl border-2 border-bad bg-bad-soft p-4">
            <p className="font-bold text-bad">
              <span aria-hidden="true">&#9888; </span>
              {a.severity === "critical" ? "Serious" : "Check"}: {a.orderCode ? `order ${a.orderCode}` : "no order"} &middot; {dateTime(a.createdAt)}
            </p>
            <p>{alertText(a.kind, a.payload)}</p>
            <div className="flex flex-wrap items-center gap-3">
              {a.orderCode && (
                <Link href={`/admin/orders/${a.orderCode}`} className={button.secondary}>
                  Open the order
                </Link>
              )}
              <form action={resolveAlertAction}>
                <input type="hidden" name="id" value={a.id} />
                <button type="submit" className={button.quiet}>
                  Mark as dealt with
                </button>
              </form>
            </div>
          </article>
        ))}
      </section>

      {c.features.delivery && (
        <section aria-labelledby="wallet" className={`${card} space-y-1 p-4 ${walletLow ? "border-2 border-bad bg-bad-soft" : ""}`}>
          <h2 id="wallet" className="text-xl font-bold">
            Delivery wallet
          </h2>
          {wallet ? (
            <>
              <p className="text-2xl font-bold tabular-nums">{money(wallet.balanceMinor)}</p>
              <p className="text-sm text-muted">
                Checked {dateTime(wallet.checkedAt)}.{walletLow ? " Running low: top it up with the delivery provider so riders can still be booked." : ""}
              </p>
            </>
          ) : (
            <p className="text-muted">Not checked yet. The balance is checked regularly while the worker is running.</p>
          )}
        </section>
      )}

      <section aria-labelledby="go" className="space-y-3">
        <h2 id="go" className="text-xl font-bold">
          Go to
        </h2>
        <div className="flex flex-wrap gap-3">
          <Link href="/admin/dashboard" className={button.secondary}>
            Dashboard
          </Link>
          <Link href="/admin/orders" className={button.secondary}>
            Orders
          </Link>
          <Link href="/admin/menu" className={button.secondary}>
            Menu
          </Link>
          <Link href="/admin/customers" className={button.secondary}>
            Customers
          </Link>
          {c.features.promos && (
            <Link href="/admin/promos" className={button.secondary}>
              Promos
            </Link>
          )}
          <Link href="/admin/qr" className={button.secondary}>
            QR codes
          </Link>
          <Link href="/admin/staff" className={button.secondary}>
            Staff
          </Link>
          <Link href="/kitchen" className={button.secondary}>
            Kitchen screen
          </Link>
        </div>
      </section>
    </div>
  );
}

export default function AdminHome(props: PageProps<"/admin">) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold leading-tight">Home</h1>
      <Suspense fallback={<div className="h-40 animate-pulse rounded-xl bg-line" role="status" aria-label="Loading" />}>
        <Home searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
