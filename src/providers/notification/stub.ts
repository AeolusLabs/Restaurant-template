import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { WebhookSignatureError } from "../payment/types";
import type { InboundMessage, NotificationMessage, NotificationProvider } from "./types";

const STUB_SECRET = "stub-whatsapp-inbound-secret";

/** Signs a body the way StubNotificationProvider.parseInbound expects (HMAC-SHA256, hex). For tests and local trials. */
export function signStubInbound(rawBody: string): string {
  return createHmac("sha256", STUB_SECRET).update(rawBody).digest("hex");
}

const inbound = z.object({ id: z.string().min(1).max(200), from: z.string().min(5).max(30), text: z.string().trim().min(1).max(4000) });

/** Records messages instead of sending them, and reads inbound ones in a simple signed format. The default until a real SMS or WhatsApp adapter is added. */
export class StubNotificationProvider implements NotificationProvider {
  readonly sent: NotificationMessage[] = [];

  async send(message: NotificationMessage): Promise<void> {
    this.sent.push(message);
  }

  parseInbound(rawBody: string, headers: Headers): InboundMessage {
    const sent = Buffer.from(headers.get("x-stub-signature") ?? "");
    const expected = Buffer.from(signStubInbound(rawBody));
    if (sent.length !== expected.length || !timingSafeEqual(sent, expected)) throw new WebhookSignatureError("invalid webhook signature");
    return inbound.parse(JSON.parse(rawBody));
  }
}
