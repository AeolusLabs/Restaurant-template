import { describe, expect, test } from "vitest";
import { ORIGIN_LOCK_HEADER, checkOriginLock, securityHeaders } from "../src/lib/perimeter";

const withHeader = (value?: string) => new Headers(value === undefined ? {} : { [ORIGIN_LOCK_HEADER]: value });

describe("checkOriginLock", () => {
  test("allows any request when ORIGIN_LOCK_SECRET is unset or empty", () => {
    expect(checkOriginLock(withHeader(), undefined)).toBe(true);
    expect(checkOriginLock(withHeader(), "")).toBe(true);
    expect(checkOriginLock(withHeader("anything"), undefined)).toBe(true);
  });

  test("rejects a request without the header when the secret is set", () => {
    expect(checkOriginLock(withHeader(), "s3cret-value")).toBe(false);
  });

  test("rejects a wrong header, including one that is a prefix or longer than the secret", () => {
    for (const bad of ["wrong", "s3cret", "s3cret-value-and-more", "S3CRET-VALUE", ""]) {
      expect(checkOriginLock(withHeader(bad), "s3cret-value"), bad).toBe(false);
    }
  });

  test("accepts the right header", () => {
    expect(checkOriginLock(withHeader("s3cret-value"), "s3cret-value")).toBe(true);
  });

  test("the header name is lower case and fixed", () => {
    expect(ORIGIN_LOCK_HEADER).toBe("x-origin-lock");
  });
});

describe("securityHeaders", () => {
  test("responses carry the baseline security headers", () => {
    const h = securityHeaders();
    expect(h["Strict-Transport-Security"]).toMatch(/max-age=\d+/);
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Permissions-Policy"]).toContain("camera=()");
    expect(h["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(h["Content-Security-Policy"]).toContain("object-src 'none'");
    expect(h["Content-Security-Policy"]).toContain("base-uri 'self'");
  });
});
