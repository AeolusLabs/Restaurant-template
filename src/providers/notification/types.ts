export type NotificationChannel = "sms" | "whatsapp";

export type NotificationMessage = {
  channel: NotificationChannel;
  to: string;
  template: string;
  vars: Record<string, string>;
};

export interface NotificationProvider {
  send(message: NotificationMessage): Promise<void>;
}
