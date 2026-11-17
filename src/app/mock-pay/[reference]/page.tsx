import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { withSystemContext } from "@/db/context";
import { orders, payments } from "@/db/schema";
import { button, card } from "@/components/ui";
import { money } from "@/lib/format";
import { providers } from "@/providers";
import { mockPayAction } from "../actions";

export const metadata: Metadata = { title: "Test payment", robots: { index: false } };

async function MockPay({ params, searchParams }: { params: PageProps<"/mock-pay/[reference]">["params"]; searchParams: PageProps<"/mock-pay/[reference]">["searchParams"] }) {
  await connection();
  if (providers().payment.name !== "mock") notFound(); // never reachable with a real provider
  const { reference: raw } = await params;
  const reference = decodeURIComponent(raw);
  const { lost } = await searchParams;
  const [row] = await withSystemContext((tx) =>
    tx
      .select({ code: orders.publicCode, amount: payments.amountMinor, status: payments.status })
      .from(payments)
      .innerJoin(orders, eq(orders.id, payments.orderId))
      .where(eq(payments.reference, reference)),
  );
  if (!row) notFound();

  return (
    <div className={`${card} space-y-4 p-6`}>
      <p className="rounded-lg bg-warn-soft p-3 text-sm font-semibold text-warn">
        This is a test payment page. No real money moves. A live restaurant shows the payment provider&apos;s page here instead.
      </p>
      <p>
        Order <strong className="tracking-widest">{row.code}</strong>
      </p>
      <p className="text-2xl font-bold">{money(row.amount)}</p>
      {lost && (
        <p className="rounded-lg bg-bad-soft p-3 text-bad" role="alert">
          The test payment service restarted and forgot this payment. Go back to your order and press Pay now to start a new one.
        </p>
      )}
      <form action={mockPayAction} className="flex flex-wrap gap-3">
        <input type="hidden" name="reference" value={reference} />
        <button type="submit" name="result" value="success" className={button.primary}>
          Pay {money(row.amount)}
        </button>
        <button type="submit" name="result" value="failed" className={button.secondary}>
          Fail this payment
        </button>
      </form>
    </div>
  );
}

export default function MockPayPage(props: PageProps<"/mock-pay/[reference]">) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold leading-tight">Test payment</h1>
      <Suspense fallback={<div className="h-48 animate-pulse rounded-xl bg-line" role="status" aria-label="Loading" />}>
        <MockPay params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
