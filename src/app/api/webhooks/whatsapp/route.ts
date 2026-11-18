import { handleWhatsAppWebhook } from "@/agents/whatsapp-webhook";
import { withScrub } from "@/lib/scrub";

/**
 * Inbound WhatsApp messages. The raw body is read (the signature covers its exact bytes); the handler verifies,
 * deduplicates and starts the support agent. A bad signature is 401, an unreadable body 400, any failure while
 * processing 500 so the provider retries. Replies are only proposed here, never sent.
 */
export const POST = withScrub(async (request: Request) => {
  const raw = await request.text();
  try {
    const { status, outcome } = await handleWhatsAppWebhook(raw, request.headers);
    return Response.json({ outcome }, { status });
  } catch (err) {
    console.error("whatsapp webhook failed", err instanceof Error ? err.message : err);
    return Response.json({ error: "Could not process the message" }, { status: 500 });
  }
});
