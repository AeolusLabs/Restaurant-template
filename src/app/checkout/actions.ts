"use server";

import { redirect } from "next/navigation";
import { getIdentity } from "@/auth/customer";
import { OrderRejectedError, createPickupOrder } from "@/db/orders";
import { createOrderSchema } from "@/domain/checkout/order-input";
import { echo, fieldErrors, text, type FormState } from "@/lib/form";
import { HUMAN_CHECK_FAILED, passesHumanCheck } from "@/lib/human-check";
import { PaymentStartError, startPayment } from "@/payments/start-payment";

const REJECTIONS: Record<OrderRejectedError["code"], string> = {
  not_a_customer: "Only customer accounts can place orders. Sign in with a customer account.",
  pickup_disabled: "Pickup orders are not available right now.",
  invalid_slot: "That pickup time is no longer available. Choose another.",
  cart_problems: "Some items in your cart can no longer be ordered. Go back to your cart to fix this.",
  price_changed: "The prices changed while you were checking out. Go back to your cart to review them.",
  profile_missing: "We could not find your account details. Please sign out and in again.",
};

/**
 * Places the order and sends the customer to pay. The browser supplies items, a pickup time, a phone number
 * and the total it displayed, never a price: the server prices the cart and refuses the order if the total
 * is not the one the customer saw. If starting the payment fails, the order still exists and the customer
 * is taken to it, where they can try paying again.
 */
export async function placeOrderAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const identity = await getIdentity();
  if (!identity) redirect("/sign-in?next=%2Fcheckout");

  const values = echo(formData, ["pickupAt", "phone", "notes"]);
  if (!(await passesHumanCheck(formData))) return { error: HUMAN_CHECK_FAILED, values };
  let lines: unknown;
  try {
    lines = JSON.parse(text(formData, "lines"));
  } catch {
    return { error: "Your cart could not be read. Go back to your cart and try again.", values };
  }
  const expected = text(formData, "expectedTotalMinor");
  const parsed = createOrderSchema.safeParse({
    lines,
    pickupAt: text(formData, "pickupAt"),
    phone: text(formData, "phone"),
    notes: text(formData, "notes"),
    expectedTotalMinor: expected === "" ? undefined : Number(expected),
    checkoutToken: text(formData, "checkoutToken"),
  });
  if (!parsed.success) {
    const errors = fieldErrors(parsed.error);
    if (errors.lines) return { error: "Your cart is empty or not valid. Go back to your cart and try again.", values };
    if (errors.pickupAt) errors.pickupAt = "Choose a pickup time";
    if (errors.checkoutToken || errors.expectedTotalMinor) return { error: "Please reload the page and try again.", values };
    return { fieldErrors: errors, values };
  }

  let code: string;
  try {
    code = (await createPickupOrder(identity.ctx, parsed.data)).order.publicCode;
  } catch (err) {
    if (err instanceof OrderRejectedError) {
      return err.code === "invalid_slot" ? { fieldErrors: { pickupAt: REJECTIONS.invalid_slot }, values } : { error: REJECTIONS[err.code], values };
    }
    throw err;
  }

  let payUrl: string;
  try {
    payUrl = (await startPayment(identity.ctx, code, { email: identity.email })).authorizationUrl;
  } catch (err) {
    if (err instanceof PaymentStartError) redirect(`/orders/${code}?payment=failed`);
    throw err;
  }
  redirect(payUrl);
}
