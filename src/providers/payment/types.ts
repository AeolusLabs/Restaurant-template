export type PaymentInitInput = {
  orderId: string;
  amountMinor: number;
  email: string;
  /** Unique per payment attempt. Also the idempotency anchor for webhooks. */
  reference: string;
  callbackUrl: string;
};
export type PaymentInit = { authorizationUrl: string; reference: string };

export type PaymentVerification = {
  status: "success" | "failed" | "abandoned";
  amountMinor: number;
  currency: string;
};

export type PaymentEvent = {
  /** Stable per event, used for webhook deduplication. */
  id: string;
  type: "charge.success" | "charge.failed" | "refund.processed" | "unknown";
  reference: string;
  amountMinor?: number;
  raw: unknown;
};

export class WebhookSignatureError extends Error {
  override name = "WebhookSignatureError";
}

/** instanceof is not enough: after a development reload, or across bundles, there can be two copies of the class. */
export const isWebhookSignatureError = (err: unknown): boolean =>
  err instanceof WebhookSignatureError || (err instanceof Error && err.name === "WebhookSignatureError");
export class PaymentProviderError extends Error {}

export interface PaymentProvider {
  /** Stored with every payment and webhook event, so records say which provider produced them. */
  readonly name: string;
  initialize(input: PaymentInitInput): Promise<PaymentInit>;
  verify(reference: string): Promise<PaymentVerification>;
  /** Throws WebhookSignatureError unless the signature over the raw body is valid. */
  parseWebhook(rawBody: string, headers: Headers): PaymentEvent;
  refund(input: { reference: string; amountMinor: number; reason?: string }): Promise<{ providerRef: string }>;
}
