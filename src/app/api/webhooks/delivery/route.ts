import { handleDeliveryWebhook } from "@/delivery/webhook";
import { withScrub } from "@/lib/scrub";

/**
 * The delivery provider's webhook. Same rules as the payment webhook: the raw body is read (the signature covers
 * its exact bytes), the handler verifies, deduplicates and applies the event, any failure while processing is 500
 * so the provider retries, a bad signature is 401 and an unreadable body is 400. Polling does not depend on this.
 */
export const POST = withScrub(async (request: Request) => {
  const raw = await request.text();
  try {
    const { status, outcome } = await handleDeliveryWebhook(raw, request.headers);
    return Response.json({ outcome }, { status });
  } catch (err) {
    console.error("delivery webhook failed", err instanceof Error ? err.message : err);
    return Response.json({ error: "Could not process the event" }, { status: 500 });
  }
});
