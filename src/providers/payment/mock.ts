import { createHmac, timingSafeEqual } from "node:crypto";
import {
  PaymentProviderError,
  WebhookSignatureError,
  type PaymentEvent,
  type PaymentInit,
  type PaymentInitInput,
  type PaymentProvider,
  type PaymentVerification,
} from "./types";

const MOCK_SECRET = "mock-payment-webhook-secret";

/** Signs a webhook body the way MockPaymentProvider.parseWebhook expects (HMAC-SHA512, hex). */
export function signMockWebhook(rawBody: string): string {
  return createHmac("sha512", MOCK_SECRET).update(rawBody).digest("hex");
}

/** A working fake for development and tests. No network, no real money. */
export class MockPaymentProvider implements PaymentProvider {
  readonly name: string = "mock";
  readonly refunds: { reference: string; amountMinor: number; reason?: string }[] = [];
  private readonly payments = new Map<string, PaymentVerification>();

  constructor(private readonly currency = "NGN") {}

  async initialize(input: PaymentInitInput): Promise<PaymentInit> {
    this.payments.set(input.reference, { status: "abandoned", amountMinor: input.amountMinor, currency: this.currency });
    // The fake payment page is a screen in this app (src/app/mock-pay), reached on the same origin as the callback.
    return { authorizationUrl: `${new URL(input.callbackUrl).origin}/mock-pay/${input.reference}`, reference: input.reference };
  }

  /** Test hook: pretend the customer finished (or failed) paying on the provider's page. */
  simulatePayment(reference: string, status: PaymentVerification["status"]): void {
    const p = this.payments.get(reference);
    if (!p) throw new PaymentProviderError(`unknown reference ${reference}`);
    this.payments.set(reference, { ...p, status });
  }

  async verify(reference: string): Promise<PaymentVerification> {
    const p = this.payments.get(reference);
    if (!p) throw new PaymentProviderError(`unknown reference ${reference}`);
    return p;
  }

  parseWebhook(rawBody: string, headers: Headers): PaymentEvent {
    const sent = headers.get("x-mock-signature") ?? "";
    const expected = signMockWebhook(rawBody);
    const a = Buffer.from(sent);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new WebhookSignatureError("invalid webhook signature");
    const body = JSON.parse(rawBody) as { id: string; event: string; data: { reference: string; amount?: number } };
    const type = (["charge.success", "charge.failed", "refund.processed"] as const).find((t) => t === body.event) ?? "unknown";
    return { id: body.id, type, reference: body.data.reference, amountMinor: body.data.amount, raw: body };
  }

  async refund(input: { reference: string; amountMinor: number; reason?: string }) {
    this.refunds.push(input);
    return { providerRef: `mock-refund-${this.refunds.length}` };
  }
}
