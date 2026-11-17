import { describe, expect, test } from "vitest";
import { loadEnv } from "../src/lib/env";

const valid = (): Record<string, string> => ({
  DATABASE_URL: "postgres://app:pw@localhost:5432/restaurant",
  DATABASE_UNPOOLED_URL: "postgres://app:pw@localhost:5432/restaurant",
  DATABASE_SYSTEM_URL: "postgres://system:pw@localhost:5432/restaurant",
  DATABASE_MIGRATOR_URL: "postgres://migrator:pw@localhost:5432/restaurant",
  BETTER_AUTH_SECRET: "x".repeat(32),
  APP_URL: "http://localhost:3000",
});

describe("loadEnv", () => {
  test("accepts a minimal valid environment", () => {
    expect(() => loadEnv(valid())).not.toThrow();
  });

  test("rejects BETTER_AUTH_SECRET shorter than 32 characters", () => {
    expect(() => loadEnv({ ...valid(), BETTER_AUTH_SECRET: "short" })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });

  test("requires PAYSTACK_SECRET_KEY when PAYMENT_PROVIDER is paystack", () => {
    expect(() => loadEnv({ ...valid(), PAYMENT_PROVIDER: "paystack" })).toThrow(
      /PAYSTACK_SECRET_KEY/,
    );
  });

  test("does not require it when PAYMENT_PROVIDER is mock", () => {
    expect(() => loadEnv({ ...valid(), PAYMENT_PROVIDER: "mock" })).not.toThrow();
  });

  test("defaults every provider selector to its local fake", () => {
    const env = loadEnv(valid());
    expect(env.PAYMENT_PROVIDER).toBe("mock");
    expect(env.DELIVERY_PROVIDER).toBe("mock");
    expect(env.NOTIFICATION_PROVIDER).toBe("stub");
    expect(env.LLM_PROVIDER).toBe("mock");
    expect(env.STORAGE_PROVIDER).toBe("memory");
  });

  test("requires the Chowdeck base URL when DELIVERY_PROVIDER is chowdeck", () => {
    expect(() =>
      loadEnv({ ...valid(), DELIVERY_PROVIDER: "chowdeck", CHOWDECK_API_KEY: "k" }),
    ).toThrow(/CHOWDECK_BASE_URL/);
  });

  test("names every missing required variable in one error", () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL[\s\S]*BETTER_AUTH_SECRET/);
  });
});
