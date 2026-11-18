import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { WebhookSignatureError } from "../payment/types";
import {
  DeliveryProviderError,
  DuplicateDeliveryError,
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

// Chowdeck Relay adapter. The only file that knows Chowdeck's field names; everything above it speaks the
// DeliveryProvider interface. Written from Chowdeck's own documentation (chowdeck-api.readme.io, read 2026-11-18)
// and covered by contract tests against a fake fetch only. Chowdeck has no sandbox, and its pages disagree with
// each other, so NOTHING here is confirmed against the live API. Open points, all to settle with a real key:
//   - the base URL (two hosts appear in the docs, so there is no default),
//   - where the webhook secret comes from, and whether Relay deliveries fire webhooks at all,
//   - the wording of the "wallet is empty" error (several wordings and HTTP 402 are recognised),
//   - the values of `item_type` and `country_code` (options, with guesses as defaults),
//   - whether the `reference` we send is the one Chowdeck returns and accepts in later lookups.

const TIMEOUT_MS = 15_000;

export type ChowdeckOptions = {
  apiKey: string;
  /** No default: the docs list two hosts. */
  baseUrl: string;
  /** For verifying webhooks. Without it every webhook is refused and polling carries on alone. */
  webhookSecret?: string;
  /** Chowdeck asks what is being sent. Food, for a restaurant. */
  itemType?: string;
  countryCode?: string;
  fetch?: typeof fetch;
};

const idLike = z.union([z.number().int(), z.string().min(1)]);
const kobo = z.number().int().nonnegative();
const quoteResponse = z.object({ data: z.object({ id: idLike, total_amount: kobo }) });
const createResponse = z
  .object({
    data: z.object({ reference: z.string().min(1), delivery_price: kobo, status: z.string().optional(), tracking_url: z.string().optional() }),
    tracking_url: z.string().optional(),
  })
  .loose();
const getResponse = z.object({ data: z.object({ status: z.string().optional() }).loose() });
const anyObject = z.object({}).loose();
const walletResponse = z.object({ data: z.object({ balance: kobo }) });

// Chowdeck's guide and its webhook page use different words for the same stages. Every word either uses is mapped
// here; anything else is "unknown", which no caller ever treats as delivered.
const STATUS: Record<string, DeliveryStatus> = {
  pending: "pending",
  preparing: "pending",
  awaiting_pickup: "awaiting_pickup",
  accepted: "awaiting_pickup",
  picked: "in_transit",
  in_transit: "in_transit",
  arrived: "in_transit",
  success: "delivered",
  completed: "delivered",
  cancelled: "cancelled",
  canceled: "cancelled",
  rejected: "failed",
};
export const mapChowdeckStatus = (word: unknown): DeliveryStatus => (typeof word === "string" ? (STATUS[word.trim().toLowerCase()] ?? "unknown") : "unknown");

/** Only a web address is ever shown to a customer as a link. */
const safeUrl = (u: string | undefined): string | undefined => {
  if (!u) return undefined;
  try {
    const p = new URL(u).protocol;
    return p === "https:" || p === "http:" ? u : undefined;
  } catch {
    return undefined;
  }
};

const webhookBody = z
  .object({
    id: idLike.optional(),
    event_id: idLike.optional(),
    reference: z.string().optional(),
    status: z.string().optional(),
    data: z.object({ reference: z.string().optional(), status: z.string().optional() }).loose().optional(),
  })
  .loose();

export class ChowdeckProvider implements DeliveryProvider {
  readonly name = "chowdeck";
  private readonly key: string;
  private readonly baseUrl: string;
  private readonly secret?: string;
  private readonly itemType: string;
  private readonly countryCode: string;
  private readonly http: typeof fetch;

  constructor(opts: ChowdeckOptions) {
    if (!opts.apiKey) throw new Error("ChowdeckProvider needs an API key (CHOWDECK_API_KEY)");
    if (!opts.baseUrl) throw new Error("ChowdeckProvider needs a base URL (CHOWDECK_BASE_URL)");
    this.key = opts.apiKey;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.secret = opts.webhookSecret || undefined;
    this.itemType = opts.itemType ?? "food";
    this.countryCode = opts.countryCode ?? "+234";
    this.http = opts.fetch ?? fetch;
  }

  /** One authorised call. Errors carry Chowdeck's own message, never the key or a raw network error. */
  private async call<S extends z.ZodType>(op: string, method: "GET" | "POST", path: string, schema: S, body?: unknown): Promise<z.output<S>> {
    let res: Response;
    try {
      res = await this.http(`${this.baseUrl}${path}`, {
        method,
        headers: { Authorization: `Bearer ${this.key}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new DeliveryProviderError(`Chowdeck ${op} could not be reached`);
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new DeliveryProviderError(`Chowdeck ${op} returned an unreadable response (HTTP ${res.status})`);
    }
    if (!res.ok) {
      const j = json as { message?: unknown; error?: unknown };
      const message = typeof j?.message === "string" ? j.message : typeof j?.error === "string" ? j.error : "no reason given";
      if (/fee.*expired|expired.*fee/i.test(message)) throw new QuoteExpiredError(message);
      if (/duplicate/i.test(message)) throw new DuplicateDeliveryError(message);
      if (res.status === 402 || /insufficient|wallet|balance|not enough/i.test(message)) throw new InsufficientWalletError(message);
      throw new DeliveryProviderError(`Chowdeck ${op} was refused (HTTP ${res.status}): ${message}`);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new DeliveryProviderError(`Chowdeck ${op} returned an unexpected response`);
    return parsed.data;
  }

  async getQuote(input: DeliveryQuoteInput): Promise<DeliveryQuote> {
    const r = await this.call("quote", "POST", "/relay/delivery/fee", quoteResponse, {
      source_address_string: input.pickup.address,
      destination_address_string: input.dropoff.address,
      ...(input.orderValueMinor === undefined ? {} : { estimated_order_amount: input.orderValueMinor }),
    });
    // No quote lifetime is documented, so none is claimed: dispatch always quotes just before booking.
    return { quoteId: String(r.data.id), feeMinor: r.data.total_amount };
  }

  async createDelivery(input: DeliveryCreateInput): Promise<DeliveryCreated> {
    const feeId = Number(input.quoteId);
    if (!Number.isInteger(feeId)) throw new DeliveryProviderError("Chowdeck create needs the numeric fee id from a quote");
    const contact = (p: DeliveryCreateInput["pickup"]) => ({ name: p.name, phone: p.phone, country_code: this.countryCode });
    const r = await this.call("create", "POST", "/relay/delivery", createResponse, {
      fee_id: feeId,
      item_type: this.itemType,
      user_action: "sending",
      source_contact: contact(input.pickup),
      destination_contact: contact(input.dropoff),
      reference: input.reference,
      ...(input.orderValueMinor === undefined ? {} : { estimated_order_amount: input.orderValueMinor }),
      ...(input.note ? { customer_delivery_note: input.note } : {}),
    });
    // A booking exists, so an unrecognised word is still "pending", never "unknown".
    const status = mapChowdeckStatus(r.data.status);
    return {
      providerRef: r.data.reference,
      status: status === "unknown" ? "pending" : status,
      trackingUrl: safeUrl(r.data.tracking_url ?? r.tracking_url),
      costMinor: r.data.delivery_price,
    };
  }

  async getDelivery(providerRef: string): Promise<{ status: DeliveryStatus; raw: unknown }> {
    const raw = await this.call("lookup", "GET", `/relay/delivery/${encodeURIComponent(providerRef)}`, getResponse);
    return { status: mapChowdeckStatus(raw.data.status), raw };
  }

  async cancel(providerRef: string, reason: string): Promise<{ refundMinor?: number }> {
    await this.call("cancel", "POST", `/relay/delivery/${encodeURIComponent(providerRef)}/cancel`, anyObject, { reason });
    return {};
  }

  async getWalletBalance(): Promise<{ balanceMinor: number }> {
    const r = await this.call("wallet", "GET", "/relay/wallet/balance", walletResponse);
    return { balanceMinor: r.data.balance };
  }

  parseWebhook(rawBody: string, headers: Headers): DeliveryEvent {
    if (!this.secret) throw new WebhookSignatureError("no webhook secret is configured");
    const sent = Buffer.from(headers.get("x-chowdeck-signature") ?? "");
    const expected = Buffer.from(createHmac("sha256", this.secret).update(rawBody).digest("hex"));
    if (sent.length !== expected.length || !timingSafeEqual(sent, expected)) throw new WebhookSignatureError("invalid webhook signature");

    const json: unknown = JSON.parse(rawBody);
    const body = webhookBody.parse(json);
    const providerRef = body.data?.reference ?? body.reference;
    if (!providerRef) throw new Error("webhook has no delivery reference");
    const word = body.data?.status ?? body.status;
    // Without an event id, the delivery and its status identify the event, so a replay is recognised.
    const id = String(body.id ?? body.event_id ?? `${providerRef}:${word ?? ""}`);
    return { id, providerRef, status: mapChowdeckStatus(word), raw: json };
  }
}
