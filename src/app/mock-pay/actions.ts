"use server";

import { eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";
import { withSystemContext } from "@/db/context";
import { orders, payments } from "@/db/schema";
import { text } from "@/lib/form";
import { handlePaymentWebhook } from "@/payments/webhook";
import { providers } from "@/providers";
import { completeMockPayment } from "@/providers/payment/mock-checkout";

/** The buttons on the fake payment page. Only works while PAYMENT_PROVIDER=mock. */
export async function mockPayAction(formData: FormData): Promise<void> {
  const provider = providers().payment;
  if (provider.name !== "mock") notFound();
  const reference = text(formData, "reference");
  const result = text(formData, "result") === "success" ? "success" : "failed";

  const [row] = await withSystemContext((tx) =>
    tx.select({ code: orders.publicCode }).from(payments).innerJoin(orders, eq(orders.id, payments.orderId)).where(eq(payments.reference, reference)),
  );
  if (!row) notFound();

  try {
    await completeMockPayment(provider, { reference, result }, handlePaymentWebhook);
  } catch {
    // The mock keeps payments in memory, so a server restart forgets them.
    redirect(`/mock-pay/${encodeURIComponent(reference)}?lost=1`);
  }
  redirect(`/orders/${row.code}`);
}
