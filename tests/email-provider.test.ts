import { describe, expect, test, vi } from "vitest";
import { loadEnv } from "../src/lib/env";
import { getProviders } from "../src/providers";
import { MockEmailProvider } from "../src/providers/email/mock";
import { EmailProviderError } from "../src/providers/email/types";

const baseEnv = {
  DATABASE_URL: "postgres://a:b@localhost/x",
  DATABASE_UNPOOLED_URL: "postgres://a:b@localhost/x",
  DATABASE_SYSTEM_URL: "postgres://a:b@localhost/x",
  DATABASE_MIGRATOR_URL: "postgres://a:b@localhost/x",
  BETTER_AUTH_SECRET: "x".repeat(32),
  APP_URL: "http://localhost:3000",
};

describe("email provider", () => {
  test("is a selectable provider that defaults to the local fake", () => {
    expect(getProviders(loadEnv(baseEnv)).email).toBeInstanceOf(MockEmailProvider);
    expect(loadEnv({ ...baseEnv, EMAIL_PROVIDER: "mock" }).EMAIL_PROVIDER).toBe("mock");
    expect(() => loadEnv({ ...baseEnv, EMAIL_PROVIDER: "carrier-pigeon" })).toThrow(/EMAIL_PROVIDER/);
  });

  test("the fake keeps what it was asked to send, and prints it so a developer can follow a link", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const p = new MockEmailProvider();
    await p.send({ to: "ada@example.com", subject: "Hello", text: "Open https://x.test/a?b=1" });
    expect(p.outbox).toEqual([{ to: "ada@example.com", subject: "Hello", text: "Open https://x.test/a?b=1" }]);
    expect(log.mock.calls.flat().join("\n")).toContain("https://x.test/a?b=1");
    log.mockRestore();
  });

  test("refuses an address that is not an email, before anything is sent", async () => {
    const p = new MockEmailProvider();
    await expect(p.send({ to: "not an email", subject: "x", text: "y" })).rejects.toBeInstanceOf(EmailProviderError);
    expect(p.outbox).toHaveLength(0);
  });
});
