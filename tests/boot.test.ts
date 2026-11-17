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
