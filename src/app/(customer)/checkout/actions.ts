"use server";

import { redirect } from "next/navigation";
import { getIdentity } from "@/auth/customer";
import { OrderRejectedError, createDeliveryOrder, createPickupOrder } from "@/db/orders";
import { promoText } from "@/domain/promos/rules";
import { createOrderSchema, deliveryOrderSchema, type CreateDeliveryOrderInput, type CreateOrderInput } from "@/domain/checkout/order-input";
import { echo, fieldErrors, text, type FormState } from "@/lib/form";
import { HUMAN_CHECK_FAILED, passesHumanCheck } from "@/lib/human-check";
import { PaymentStartError, startPayment } from "@/payments/start-payment";

const REJECTIONS: Record<OrderRejectedError["code"], string> = {
  not_a_customer: "Only customer accounts can place orders. Sign in with a customer account.",
  pickup_disabled: "Pickup orders are not available right now.",
  delivery_disabled: "Delivery orders are not available right now.",
  closed: "We are closed, so we cannot take a delivery order right now.",
  invalid_zone: "We do not deliver to that area. Choose one from the list.",
  invalid_slot: "That pickup time is no longer available. Choose another.",
  cart_problems: "Some items in your cart can no longer be ordered. Go back to your cart to fix this.",
  price_changed: "The prices changed while you were checking out. Go back to your cart to review them.",
  promo_invalid: "That promo code cannot be used.",
  profile_missing: "We could not find your account details. Please sign out and in again.",
};

/**
 * Places the order and sends the customer to pay. The browser supplies items, a pickup time or a delivery zone and
 * address, a phone number and the total it displayed, never a price or a delivery fee: the server prices the cart and refuses the order if the total
 * is not the one the customer saw. If starting the payment fails, the order still exists and the customer
 * is taken to it, where they can try paying again.
 */
export async function placeOrderAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const identity = await getIdentity();
  if (!identity) redirect("/sign-in?next=%2Fcheckout");

  const delivery = text(formData, "fulfilment") === "delivery";
  const values = echo(formData, ["fulfilment", "pickupAt", "zone", "address", "landmark", "promoCode", "phone", "notes"]);
  if (!(await passesHumanCheck(formData))) return { error: HUMAN_CHECK_FAILED, values };
  let lines: unknown;
  try {
    lines = JSON.parse(text(formData, "lines"));
  } catch {
    return { error: "Your cart could not be read. Go back to your cart and try again.", values };
  }
  const expected = text(formData, "expectedTotalMinor");
  const common = {
    lines,
    phone: text(formData, "phone"),
    notes: text(formData, "notes"),
    promoCode: text(formData, "promoCode"),
    expectedTotalMinor: expected === "" ? undefined : Number(expected),
    checkoutToken: text(formData, "checkoutToken"),
  };
  const parsed = delivery
    ? deliveryOrderSchema.safeParse({ ...common, zone: text(formData, "zone"), address: text(formData, "address"), landmark: text(formData, "landmark") })
    : createOrderSchema.safeParse({ ...common, pickupAt: text(formData, "pickupAt") });
  if (!parsed.success) {
    const errors = fieldErrors(parsed.error);
    if (errors.lines) return { error: "Your cart is empty or not valid. Go back to your cart and try again.", values };
    if (errors.pickupAt) errors.pickupAt = "Choose a pickup time";
    if (errors.checkoutToken || errors.expectedTotalMinor) return { error: "Please reload the page and try again.", values };
    return { fieldErrors: errors, values };
  }

  let code: string;
  try {
    const placed = delivery ? await createDeliveryOrder(identity.ctx, parsed.data as CreateDeliveryOrderInput) : await createPickupOrder(identity.ctx, parsed.data as CreateOrderInput);
    code = placed.order.publicCode;
  } catch (err) {
    if (err instanceof OrderRejectedError) {
      if (err.code === "invalid_slot") return { fieldErrors: { pickupAt: REJECTIONS.invalid_slot }, values };
      if (err.code === "promo_invalid") return { fieldErrors: { promoCode: promoText(err.promoReason ?? "unknown") }, values };
      if (err.code === "invalid_zone") return { fieldErrors: { zone: REJECTIONS.invalid_zone }, values };
      return { error: REJECTIONS[err.code], values };
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
