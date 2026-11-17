import { withScrub } from "@/lib/scrub";
import { handlePaymentWebhook } from "@/payments/webhook";

/**
 * The payment provider's webhook. It reads the raw body (the signature covers its exact bytes), and the
 * handler verifies, deduplicates and applies the event. Any failure while processing returns 500 so the
 * provider retries; a bad signature is 401 and an unreadable body is 400.
 */
export const POST = withScrub(async (request: Request) => {
  const raw = await request.text();
  try {
    const { status, outcome } = await handlePaymentWebhook(raw, request.headers);
    return Response.json({ outcome }, { status });
  } catch (err) {
    console.error("payment webhook failed", err instanceof Error ? err.message : err);
    return Response.json({ error: "Could not process the event" }, { status: 500 });
  }
});
