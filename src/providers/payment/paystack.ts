import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { assertMinor } from "@/lib/money";
import {
  PaymentProviderError,
  WebhookSignatureError,
  type PaymentEvent,
  type PaymentInit,
  type PaymentInitInput,
  type PaymentProvider,
  type PaymentVerification,
} from "./types";

// Paystack adapter. The only file that knows Paystack's field names; everything above it speaks the
// PaymentProvider interface. Written from Paystack's public API (initialize, verify, refund, and the
// x-paystack-signature HMAC-SHA512 webhook) and covered by contract tests against a fake fetch only.
// NOT yet confirmed against the live API: do that with a test key before launch.

const BASE_URL = "https://api.paystack.co";
const TIMEOUT_MS = 15_000;

export type PaystackOptions = {
  secretKey: string;
  /** ISO currency code the restaurant charges in (config.currency.code). */
  currency?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

const envelope = <T extends z.ZodType>(data: T) => z.object({ status: z.boolean(), message: z.string().optional(), data });
const initResponse = envelope(z.object({ authorization_url: z.url(), reference: z.string().min(1) }));
const verifyResponse = envelope(z.object({ status: z.string(), amount: z.number().int(), currency: z.string() }));
const refundResponse = envelope(z.object({ id: z.union([z.number(), z.string()]) }));
const webhookBody = z.object({
  event: z.string(),
  data: z
    .object({
      id: z.union([z.number(), z.string()]).optional(),
      reference: z.string().optional(),
      transaction_reference: z.string().optional(),
      amount: z.number().optional(),
    })
    .loose(),
});

export class PaystackProvider implements PaymentProvider {
  readonly name = "paystack";
  private readonly key: string;
  private readonly currency: string;
  private readonly baseUrl: string;
  private readonly http: typeof fetch;

  constructor(opts: PaystackOptions) {
    if (!opts.secretKey) throw new Error("PaystackProvider needs a secret key (PAYSTACK_SECRET_KEY)");
    this.key = opts.secretKey;
    this.currency = opts.currency ?? "NGN";
    this.baseUrl = opts.baseUrl ?? BASE_URL;
    this.http = opts.fetch ?? fetch;
  }

  /** One authorised call. Errors carry Paystack's own message, never the key or a raw network error. */
  private async call<S extends z.ZodType>(op: string, path: string, schema: S, body?: unknown): Promise<z.output<S>> {
    let res: Response;
    try {
      res = await this.http(`${this.baseUrl}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { Authorization: `Bearer ${this.key}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new PaymentProviderError(`Paystack ${op} could not be reached`);
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new PaymentProviderError(`Paystack ${op} returned an unreadable response (HTTP ${res.status})`);
    }
    if (!res.ok || (json as { status?: unknown })?.status === false) {
      const message = typeof (json as { message?: unknown })?.message === "string" ? (json as { message: string }).message : "no reason given";
      throw new PaymentProviderError(`Paystack ${op} was refused (HTTP ${res.status}): ${message}`);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new PaymentProviderError(`Paystack ${op} returned an unexpected response`);
    return parsed.data;
  }

  async initialize(input: PaymentInitInput): Promise<PaymentInit> {
    assertMinor(input.amountMinor);
    const r = await this.call("initialize", "/transaction/initialize", initResponse, {
      email: input.email,
      amount: input.amountMinor,
      reference: input.reference,
      callback_url: input.callbackUrl,
      currency: this.currency,
      metadata: { order_id: input.orderId },
    });
    return { authorizationUrl: r.data.authorization_url, reference: r.data.reference };
  }

  async verify(reference: string): Promise<PaymentVerification> {
    const r = await this.call("verify", `/transaction/verify/${encodeURIComponent(reference)}`, verifyResponse);
    const s = r.data.status;
    // Anything that is not clearly a success or a failure is "not paid (yet)", never "paid".
    const status = s === "success" ? "success" : s === "failed" || s === "reversed" ? "failed" : "abandoned";
    return { status, amountMinor: r.data.amount, currency: r.data.currency };
  }

  parseWebhook(rawBody: string, headers: Headers): PaymentEvent {
    const sent = headers.get("x-paystack-signature") ?? "";
    const expected = createHmac("sha512", this.key).update(rawBody).digest("hex");
    const a = Buffer.from(sent);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new WebhookSignatureError("invalid webhook signature");

    const body = webhookBody.parse(JSON.parse(rawBody));
    const type = (["charge.success", "refund.processed"] as const).find((t) => t === body.event) ?? "unknown";
    const reference = body.data.reference ?? body.data.transaction_reference ?? "";
    // One payment can be announced several times, so identity is the event type plus the reference.
    // Refund events carry the refund's own id, which tells two refunds on one payment apart.
    const key = type === "refund.processed" ? (body.data.id ?? reference) : reference || (body.data.id ?? "");
    return { id: `${body.event}:${key}`, type, reference, amountMinor: body.data.amount, raw: JSON.parse(rawBody) };
  }

  async refund(input: { reference: string; amountMinor: number; reason?: string }): Promise<{ providerRef: string }> {
    assertMinor(input.amountMinor);
    const r = await this.call("refund", "/refund", refundResponse, {
      transaction: input.reference,
      amount: input.amountMinor,
      currency: this.currency,
      ...(input.reason ? { merchant_note: input.reason } : {}),
    });
    return { providerRef: String(r.data.id) };
  }
}
