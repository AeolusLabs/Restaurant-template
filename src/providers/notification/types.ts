export type NotificationChannel = "sms" | "whatsapp";

export type NotificationMessage = {
  channel: NotificationChannel;
  to: string;
  template: string;
  vars: Record<string, string>;
};

/** A message a customer sent to the restaurant's WhatsApp number. */
export type InboundMessage = { id: string; from: string; text: string };

export interface NotificationProvider {
  send(message: NotificationMessage): Promise<void>;
  /** Reads an inbound message from a webhook. Throws a WebhookSignatureError unless the signature over the raw body is valid. */
  parseInbound(rawBody: string, headers: Headers): InboundMessage;
}
