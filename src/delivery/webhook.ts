import { eq } from "drizzle-orm";
import { withSystemContext } from "@/db/context";
import { deliveries, webhookEvents } from "@/db/schema";
import { providers } from "@/providers";
import type { DeliveryProvider } from "@/providers/delivery/types";
import { isWebhookSignatureError } from "@/providers/payment/types";
import { applyDeliveryStatus } from "./sync";

export type DeliveryWebhookResult = {
  status: 200 | 400 | 401;
  outcome: "applied" | "duplicate" | "unknown_reference" | "bad_signature" | "bad_payload";
};

/**
 * The delivery provider's webhook. Same rules as the payment webhook: the signature is checked on the raw body,
 * the event is stored under a unique key so a replay changes nothing, and a failure while processing rolls the
 * event back so the provider's retry is processed. Polling is the primary source of status (Chowdeck does not
 * document where its webhook secret comes from), so this is a faster path, not the only one.
 */
export async function handleDeliveryWebhook(
  rawBody: string,
  headers: Headers,
  deps: { provider?: DeliveryProvider; systemUrl?: string } = {},
): Promise<DeliveryWebhookResult> {
  const provider = deps.provider ?? providers().delivery;
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
        .values({ provider: `delivery:${provider.name}`, eventId: event.id, eventType: `delivery.${event.status}`, payload: event.raw })
        .onConflictDoNothing()
        .returning({ id: webhookEvents.id });
      if (!stored) return "duplicate" as const;

      const [d] = await tx.select({ id: deliveries.id }).from(deliveries).where(eq(deliveries.providerRef, event.providerRef));
      let result: "applied" | "unknown_reference" = "unknown_reference";
      if (d) {
        await applyDeliveryStatus(tx, d.id, event.status);
        result = "applied";
      }
      await tx.update(webhookEvents).set({ processedAt: new Date() }).where(eq(webhookEvents.id, stored.id));
      return result;
    },
    { url: deps.systemUrl },
  );
  return { status: 200, outcome };
}
