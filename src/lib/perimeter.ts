import { createHash, timingSafeEqual } from "node:crypto";

// Cloudflare adds this header to every proxied request (a Transform Rule, see docs/runbook.md).
// The origin refuses requests without it, so Railway's own public URL cannot be used to skip the WAF.
export const ORIGIN_LOCK_HEADER = "x-origin-lock";

const digest = (value: string) => createHash("sha256").update(value).digest();

/** True when no secret is configured (local development), or the header matches it. Constant time. */
export function checkOriginLock(headers: Headers, secret: string | undefined): boolean {
  if (!secret) return true;
  const sent = headers.get(ORIGIN_LOCK_HEADER);
  if (sent === null) return false;
  // Hashing first makes both buffers the same length, so the comparison leaks neither value nor length.
  return timingSafeEqual(digest(sent), digest(secret));
}

/**
 * Headers every response carries. The Content-Security-Policy here is deliberately limited to the
 * directives that cannot break Next.js inline scripts. A strict script-src with per-request nonces
 * is added in Phase 2, when there are real pages to test it against.
 */
export function securityHeaders(): Record<string, string> {
  return {
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(self), payment=(self)",
    "Content-Security-Policy": "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
  };
}
