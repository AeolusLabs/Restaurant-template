import { z } from "zod";
import { EmailProviderError, type EmailMessage, type EmailProvider } from "./types";

const address = z.email();

/**
 * A working fake for development and tests. Nothing is sent: messages are kept in `outbox` and printed to the
 * server log, so a developer can copy a reset link out of the terminal. A deployment that keeps this provider
 * never delivers email, so password reset cannot work there (docs/runbook.md section 8).
 */
export class MockEmailProvider implements EmailProvider {
  readonly name: string = "mock";
  readonly outbox: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    if (!address.safeParse(message.to).success) throw new EmailProviderError("The recipient is not a valid email address");
    this.outbox.push(message);
    console.info(`[mock email] to ${message.to}: ${message.subject}\n${message.text}`);
  }
}
