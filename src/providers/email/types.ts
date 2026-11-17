export type EmailMessage = { to: string; subject: string; text: string };

export class EmailProviderError extends Error {
  override name = "EmailProviderError";
}

/** Sends plain-text email: password reset links today, receipts or notices later. */
export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}
