import type { NotificationMessage, NotificationProvider } from "./types";

/** Records messages instead of sending them. The default until an SMS or WhatsApp adapter is added. */
export class StubNotificationProvider implements NotificationProvider {
  readonly sent: NotificationMessage[] = [];

  async send(message: NotificationMessage): Promise<void> {
    this.sent.push(message);
  }
}
