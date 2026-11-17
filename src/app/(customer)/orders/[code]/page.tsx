import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { restaurantConfig as c } from "../../../../../config/restaurant";
import { requireCustomer } from "@/auth/customer";
import { OrderTracker } from "@/components/order-tracker";
import { button } from "@/components/ui";
import { getOrderForCustomer } from "@/db/orders";
import { isPayable } from "@/domain/orders/presentation";
import { toPublicOrder } from "@/lib/sanitize";
import { dateTime } from "@/lib/format";
import { cancelOrderAction, payAgainAction } from "../actions";

export const metadata: Metadata = { title: "Your order" };

async function Order({ params, searchParams }: { params: PageProps<"/orders/[code]">["params"]; searchParams: PageProps<"/orders/[code]">["searchParams"] }) {
  await connection();
  const { code: rawCode } = await params;
  const code = rawCode.toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) notFound();
  const { ctx } = await requireCustomer(`/orders/${code}`);
  const found = await getOrderForCustomer(ctx, code);
  if (!found) notFound();
  const { order, items } = found;
  const { payment, cancel } = await searchParams;

  const unpaid = order.status === "placed";
  const stillPayable = isPayable(order, new Date());
  const cancellable = unpaid || order.status === "paid";

  return (
    <div className="space-y-6">
      {payment === "failed" && unpaid && (
        <p className="rounded-lg bg-warn-soft p-4 font-semibold text-warn" role="alert">
          We could not start your payment. Nothing was charged. You can try again below.
        </p>
      )}
      {cancel === "too_late" && (
        <p className="rounded-lg bg-warn-soft p-4 font-semibold text-warn" role="alert">
          The restaurant has already started on this order, so it cannot be cancelled here. Please contact them.
        </p>
      )}
      <OrderTracker
        initial={toPublicOrder(order, items)}
        pickupLabel={order.pickupAt ? dateTime(order.pickupAt) : null}
        holdUntilLabel={order.expiresAt ? dateTime(order.expiresAt) : null}
        address={[c.address.line1, c.address.area, c.address.city].filter(Boolean).join(", ")}
        charges={c.charges}
      />
      {cancellable && (
        <div className="flex flex-wrap items-center gap-3">
          {stillPayable && (
            <form action={payAgainAction}>
              <input type="hidden" name="code" value={code} />
              <button type="submit" className={button.primary}>
                Pay now
              </button>
            </form>
          )}
          <details className="group">
            <summary className={`${button.quiet} cursor-pointer list-none`}>Cancel this order</summary>
            <form action={cancelOrderAction} className="mt-2 flex flex-wrap items-center gap-3 rounded-lg border border-line p-3">
              <input type="hidden" name="code" value={code} />
              <span>{unpaid ? "Cancel this unpaid order?" : "Cancel this order? You will be refunded in full."}</span>
              <button type="submit" className={button.danger}>
                Yes, cancel it
              </button>
            </form>
          </details>
        </div>
      )}
      <Link href="/orders" className={button.quiet}>
        All my orders
      </Link>
    </div>
  );
}

export default function OrderPage(props: PageProps<"/orders/[code]">) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold leading-tight">Your order</h1>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-line" role="status" aria-label="Loading your order" />}>
        <Order params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
