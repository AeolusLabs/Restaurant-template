import { randomUUID } from "node:crypto";
import { MockPaymentProvider, signMockWebhook } from "./mock";
import type { PaymentProvider } from "./types";

/**
 * What the fake payment page does when someone presses "Pay" or "Fail". It marks the payment on the mock
 * provider and, for a success, delivers a correctly signed webhook through `deliver`, which is the real
 * webhook handler. The purchase therefore takes exactly the path a real provider's webhook takes.
 */
export async function completeMockPayment(
  provider: PaymentProvider,
  input: { reference: string; result: "success" | "failed" },
  deliver: (rawBody: string, headers: Headers) => Promise<unknown>,
): Promise<void> {
  if (!(provider instanceof MockPaymentProvider)) {
    throw new Error("The fake payment page only works with PAYMENT_PROVIDER=mock");
  }
  provider.simulatePayment(input.reference, input.result);
  if (input.result !== "success") return;
  const body = JSON.stringify({ id: `evt_${randomUUID()}`, event: "charge.success", data: { reference: input.reference } });
  await deliver(body, new Headers({ "x-mock-signature": signMockWebhook(body) }));
}
