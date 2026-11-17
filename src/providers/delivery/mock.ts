import { createHmac, timingSafeEqual } from "node:crypto";
import { WebhookSignatureError } from "../payment/types";
import {
  DeliveryProviderError,
  InsufficientWalletError,
  QuoteExpiredError,
  type DeliveryCreateInput,
  type DeliveryCreated,
  type DeliveryEvent,
  type DeliveryProvider,
  type DeliveryQuote,
  type DeliveryQuoteInput,
  type DeliveryStatus,
} from "./types";

const MOCK_SECRET = "mock-delivery-webhook-secret";
const FLOW: DeliveryStatus[] = ["pending", "awaiting_pickup", "in_transit", "delivered"];
const KNOWN = new Set<string>(["pending", "awaiting_pickup", "in_transit", "delivered", "cancelled", "failed"]);

/** Signs a webhook body the way MockDeliveryProvider.parseWebhook expects (HMAC-SHA256, hex). */
export function signMockDeliveryWebhook(rawBody: string): string {
  return createHmac("sha256", MOCK_SECRET).update(rawBody).digest("hex");
}

/** A working fake for development and tests. It models quotes that expire and a prepaid wallet. */
export class MockDeliveryProvider implements DeliveryProvider {
  private wallet: number;
  private readonly fee: number;
  private failNext = false;
  private seq = 0;
  private readonly quotes = new Map<string, { feeMinor: number; expired: boolean }>();
  private readonly deliveries = new Map<string, { status: DeliveryStatus; feeMinor: number }>();

  constructor(opts: { feeMinor?: number; walletMinor?: number } = {}) {
    this.fee = opts.feeMinor ?? 150_000;
    this.wallet = opts.walletMinor ?? 10_000_000;
  }

  /** Test hook: the next createDelivery fails once, like a provider outage. */
  failNextCreate(): void {
    this.failNext = true;
  }
  expireQuote(quoteId: string): void {
    const q = this.quotes.get(quoteId);
    if (q) q.expired = true;
  }
  setWalletBalance(balanceMinor: number): void {
    this.wallet = balanceMinor;
  }
  /** Test hook: move a delivery one step along pending, awaiting_pickup, in_transit, delivered. */
  advance(providerRef: string): DeliveryStatus {
    const d = this.deliveries.get(providerRef);
    if (!d) throw new DeliveryProviderError(`unknown delivery ${providerRef}`);
    const next = FLOW[Math.min(FLOW.indexOf(d.status) + 1, FLOW.length - 1)];
    if (FLOW.includes(d.status)) d.status = next;
    return d.status;
  }

  async getQuote(_input: DeliveryQuoteInput): Promise<DeliveryQuote> {
    const quoteId = `mock-quote-${++this.seq}`;
    this.quotes.set(quoteId, { feeMinor: this.fee, expired: false });
    return { quoteId, feeMinor: this.fee, expiresAt: new Date(Date.now() + 5 * 60_000) };
  }

  async createDelivery(input: DeliveryCreateInput): Promise<DeliveryCreated> {
    if (this.failNext) {
      this.failNext = false;
      throw new DeliveryProviderError("mock provider failure");
    }
    const quote = this.quotes.get(input.quoteId);
    if (!quote || quote.expired) throw new QuoteExpiredError("This delivery fee has expired.");
    if (this.wallet < quote.feeMinor) throw new InsufficientWalletError("Insufficient funds in wallet.");
    this.wallet -= quote.feeMinor;
    const providerRef = `mock-del-${++this.seq}`;
    this.deliveries.set(providerRef, { status: "pending", feeMinor: quote.feeMinor });
    return { providerRef, status: "pending", trackingUrl: `https://mock-delivery.invalid/track/${providerRef}`, costMinor: quote.feeMinor };
  }

  async getDelivery(providerRef: string) {
    const d = this.deliveries.get(providerRef);
    if (!d) throw new DeliveryProviderError(`unknown delivery ${providerRef}`);
    return { status: d.status, raw: { reference: providerRef, status: d.status } };
  }

  async cancel(providerRef: string, _reason: string) {
    const d = this.deliveries.get(providerRef);
    if (!d) throw new DeliveryProviderError(`unknown delivery ${providerRef}`);
    if (d.status === "delivered" || d.status === "cancelled") throw new DeliveryProviderError(`cannot cancel a ${d.status} delivery`);
    d.status = "cancelled";
    this.wallet += d.feeMinor;
    return { refundMinor: d.feeMinor };
  }

  async getWalletBalance() {
    return { balanceMinor: this.wallet };
  }

  parseWebhook(rawBody: string, headers: Headers): DeliveryEvent {
    const sent = Buffer.from(headers.get("x-mock-signature") ?? "");
    const expected = Buffer.from(signMockDeliveryWebhook(rawBody));
    if (sent.length !== expected.length || !timingSafeEqual(sent, expected)) throw new WebhookSignatureError("invalid webhook signature");
    const body = JSON.parse(rawBody) as { id: string; reference: string; status: string };
    return {
      id: body.id,
      providerRef: body.reference,
      status: KNOWN.has(body.status) ? (body.status as DeliveryStatus) : "unknown",
      raw: body,
    };
  }
}
