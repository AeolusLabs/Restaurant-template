"use server";

import { redirect } from "next/navigation";
import { getIdentity } from "@/auth/customer";
import { cancelMyOrder } from "@/payments/customer-cancel";
import { IllegalTransitionError, OrderNotFoundError } from "@/domain/orders/transitions";
import { text } from "@/lib/form";
import { PaymentStartError, startPayment } from "@/payments/start-payment";

const CODE = /^[A-Z0-9]{6}$/;

/** Tries paying for an unpaid order again, with a new payment attempt. */
export async function payAgainAction(formData: FormData): Promise<void> {
  const code = text(formData, "code");
  if (!CODE.test(code)) redirect("/orders");
  const identity = await getIdentity();
  if (!identity) redirect(`/sign-in?next=${encodeURIComponent(`/orders/${code}`)}`);

  let url: string;
  try {
    url = (await startPayment(identity.ctx, code, { email: identity.email })).authorizationUrl;
  } catch (err) {
    if (err instanceof PaymentStartError || err instanceof OrderNotFoundError) redirect(`/orders/${code}?payment=failed`);
    throw err;
  }
  redirect(url);
}

/** Lets the customer cancel their order: any time before it is paid, and with a refund until the restaurant accepts it. */
export async function cancelOrderAction(formData: FormData): Promise<void> {
  const code = text(formData, "code");
  if (!CODE.test(code)) redirect("/orders");
  const identity = await getIdentity();
  if (!identity) redirect(`/sign-in?next=${encodeURIComponent(`/orders/${code}`)}`);
  try {
    await cancelMyOrder(identity.ctx, code);
  } catch (err) {
    // Too late, already cancelled, or not theirs: the order page shows the real state.
    if (err instanceof IllegalTransitionError) redirect(`/orders/${code}?cancel=too_late`);
    if (!(err instanceof OrderNotFoundError)) throw err;
  }
  redirect(`/orders/${code}`);
}
