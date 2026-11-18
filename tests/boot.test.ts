import { describe, expect, test } from "vitest";
import { EnvError } from "../src/lib/env";
import { validateBoot } from "../src/lib/boot";

const valid = {
  DATABASE_URL: "postgres://a:b@localhost/x",
  DATABASE_UNPOOLED_URL: "postgres://a:b@localhost/x",
  DATABASE_SYSTEM_URL: "postgres://a:b@localhost/x",
  DATABASE_MIGRATOR_URL: "postgres://a:b@localhost/x",
  BETTER_AUTH_SECRET: "x".repeat(32),
  APP_URL: "http://localhost:3000",
};

describe("validateBoot", () => {
  test("returns the enabled module ids for a valid environment", () => {
    const result = validateBoot(valid);
    expect(result.modules).toContain("pickup");
  });

  test("throws a readable EnvError naming every missing variable", () => {
    expect(() => validateBoot({})).toThrow(EnvError);
    expect(() => validateBoot({})).toThrow(/DATABASE_URL[\s\S]*BETTER_AUTH_SECRET/);
  });

  test("a real provider selected without its key stops boot", () => {
    expect(() => validateBoot({ ...valid, PAYMENT_PROVIDER: "paystack" })).toThrow(/PAYSTACK_SECRET_KEY/);
  });
});

describe("demo mode", () => {
  const demo = { promos: false, pickup: true, delivery: false, ai_agents: false, demo_mode: true };
  const real = {
    PAYMENT_PROVIDER: "paystack",
    PAYSTACK_SECRET_KEY: "sk_test_x",
    DELIVERY_PROVIDER: "chowdeck",
    CHOWDECK_API_KEY: "k",
    CHOWDECK_BASE_URL: "https://example.invalid",
    LLM_PROVIDER: "anthropic",
    ANTHROPIC_API_KEY: "k",
    ANTHROPIC_MODEL: "m",
  };

  test("starts with the mock providers, which is what a fresh install uses", () => {
    expect(() => validateBoot(valid, demo)).not.toThrow();
  });

  test("refuses a real payment provider, and says why", () => {
    expect(() => validateBoot({ ...valid, PAYMENT_PROVIDER: "paystack", PAYSTACK_SECRET_KEY: "sk_test_x" }, demo)).toThrow(/demo mode[\s\S]*PAYMENT_PROVIDER/i);
  });

  test("refuses a real delivery provider or a real AI model", () => {
    expect(() => validateBoot({ ...valid, DELIVERY_PROVIDER: "chowdeck", CHOWDECK_API_KEY: "k", CHOWDECK_BASE_URL: "https://example.invalid" }, demo)).toThrow(/DELIVERY_PROVIDER/);
    expect(() => validateBoot({ ...valid, LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k", ANTHROPIC_MODEL: "m" }, demo)).toThrow(/LLM_PROVIDER/);
  });

  test("names every real provider at once", () => {
    expect(() => validateBoot({ ...valid, ...real }, demo)).toThrow(/PAYMENT_PROVIDER[\s\S]*DELIVERY_PROVIDER[\s\S]*LLM_PROVIDER/);
  });

  test("with demo mode off, real providers are allowed as before", () => {
    expect(() => validateBoot({ ...valid, ...real }, { ...demo, demo_mode: false })).not.toThrow();
  });
});
