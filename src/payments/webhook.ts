import { eq } from "drizzle-orm";
import { withSystemContext } from "@/db/context";
import { webhookEvents } from "@/db/schema";
import { providers } from "@/providers";
import { isWebhookSignatureError, type PaymentProvider } from "@/providers/payment/types";
import { settlePayment, type SettleOutcome } from "./apply-payment";

export type WebhookResult = {
  /** 401 for a bad signature, 400 for a body that cannot be read, 200 for everything we accepted. */
  status: 200 | 400 | 401;
  outcome: SettleOutcome | "duplicate" | "ignored" | "bad_signature" | "bad_payload";
};

export type WebhookDeps = { provider?: PaymentProvider; systemUrl?: string };

/**
 * Handles a payment provider's webhook (docs/ARCHITECTURE.md section 13). The caller passes the raw body,
 * unparsed, because the signature covers its exact bytes. The signature is checked first, in constant time
 * by the provider's parser. The event is then stored under a unique (provider, event id) key, and only a
 * newly stored event is processed, in the same transaction as the payment and order changes. A replayed or
 * concurrent duplicate event therefore changes nothing. If processing throws (the provider could not be
 * reached, say) the transaction rolls back, the event is not stored, and the provider's retry is processed.
 */
export async function handlePaymentWebhook(rawBody: string, headers: Headers, deps: WebhookDeps = {}): Promise<WebhookResult> {
  const provider = deps.provider ?? providers().payment;

  let event;
  try {
    event = provider.parseWebhook(rawBody, headers);
  } catch (err) {
    if (isWebhookSignatureError(err)) return { status: 401, outcome: "bad_signature" };
    return { status: 400, outcome: "bad_payload" };
  }

  const outcome = await withSystemContext(
    async (tx) => {
      const [stored] = await tx
        .insert(webhookEvents)
        .values({ provider: provider.name, eventId: event.id, eventType: event.type, payload: event.raw })
        .onConflictDoNothing()
        .returning({ id: webhookEvents.id });
      if (!stored) return "duplicate" as const;

      // Only a successful charge is acted on. Anything else is kept on record and acknowledged.
      const result = event.type === "charge.success" ? await settlePayment(tx, event.reference, provider) : ("ignored" as const);
      await tx.update(webhookEvents).set({ processedAt: new Date() }).where(eq(webhookEvents.id, stored.id));
      return result;
    },
    { url: deps.systemUrl },
  );
  return { status: 200, outcome };
}
