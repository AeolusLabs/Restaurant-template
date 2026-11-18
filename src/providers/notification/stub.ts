import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { WebhookSignatureError } from "../payment/types";
import type { InboundMessage, NotificationMessage, NotificationProvider } from "./types";

/** Signs a body the way StubNotificationProvider.parseInbound expects (HMAC-SHA256, hex). For tests and local trials. */
export function signStubInbound(rawBody: string, secret: string | undefined = process.env.STUB_INBOUND_SECRET): string {
  if (!secret) throw new Error("STUB_INBOUND_SECRET is not set");
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

const inbound = z.object({ id: z.string().min(1).max(200), from: z.string().min(5).max(30), text: z.string().trim().min(1).max(4000) });

/** Records messages instead of sending them, and reads inbound ones in a simple signed format. The default until a real SMS or WhatsApp adapter is added. */
export class StubNotificationProvider implements NotificationProvider {
  readonly sent: NotificationMessage[] = [];

  async send(message: NotificationMessage): Promise<void> {
    this.sent.push(message);
  }

  parseInbound(rawBody: string, headers: Headers): InboundMessage {
    // No secret in the source: with none configured nothing is accepted, so a default install cannot be sent forged messages.
    const secret = process.env.STUB_INBOUND_SECRET;
    if (!secret) throw new WebhookSignatureError("inbound messages are switched off: STUB_INBOUND_SECRET is not set");
    const sent = Buffer.from(headers.get("x-stub-signature") ?? "");
    const expected = Buffer.from(signStubInbound(rawBody, secret));
    if (sent.length !== expected.length || !timingSafeEqual(sent, expected)) throw new WebhookSignatureError("invalid webhook signature");
    return inbound.parse(JSON.parse(rawBody));
  }
}
