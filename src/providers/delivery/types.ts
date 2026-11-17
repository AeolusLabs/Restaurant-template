/** The internal delivery vocabulary. Adapters map every vendor status onto these and never leak vendor names. */
export type DeliveryStatus = "pending" | "awaiting_pickup" | "in_transit" | "delivered" | "cancelled" | "failed" | "unknown";

export type DeliveryPoint = {
  name: string;
  phone: string;
  address: string;
  /** Degrees times one million, like addresses.lat_micro. */
  latMicro?: number;
  lngMicro?: number;
};

export type DeliveryQuoteInput = { pickup: DeliveryPoint; dropoff: DeliveryPoint; orderValueMinor?: number };
export type DeliveryQuote = { quoteId: string; feeMinor: number; expiresAt?: Date };
export type DeliveryCreateInput = DeliveryQuoteInput & { quoteId: string; reference: string; note?: string };
export type DeliveryCreated = { providerRef: string; status: DeliveryStatus; trackingUrl?: string; costMinor: number };
export type DeliveryEvent = { id: string; providerRef: string; status: DeliveryStatus; raw: unknown };

export class DeliveryProviderError extends Error {}
/** The quote is no longer valid. The caller should get a fresh quote and retry once. */
export class QuoteExpiredError extends DeliveryProviderError {}
/** The prepaid wallet cannot cover the delivery. */
export class InsufficientWalletError extends DeliveryProviderError {}

export interface DeliveryProvider {
  getQuote(input: DeliveryQuoteInput): Promise<DeliveryQuote>;
  createDelivery(input: DeliveryCreateInput): Promise<DeliveryCreated>;
  getDelivery(providerRef: string): Promise<{ status: DeliveryStatus; raw: unknown }>;
  cancel(providerRef: string, reason: string): Promise<{ refundMinor?: number }>;
  getWalletBalance(): Promise<{ balanceMinor: number }>;
  /** Throws unless the signature over the raw body is valid. */
  parseWebhook(rawBody: string, headers: Headers): DeliveryEvent;
}
