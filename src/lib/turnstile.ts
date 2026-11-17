// Cloudflare Turnstile, checked on the server (docs/ARCHITECTURE.md section 11). The widget in the browser
// only produces a token; this is what decides whether it is real. With no secret configured the check is
// switched off (local development), with a secret it fails closed: anything unexpected counts as "not a human".

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
let warnedOff = false;

export type TurnstileOptions = { secret?: string; remoteIp?: string; fetch?: typeof fetch };

export async function verifyTurnstile(token: string | null | undefined, opts: TurnstileOptions = {}): Promise<boolean> {
  const secret = "secret" in opts ? opts.secret : process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    if (!warnedOff) {
      warnedOff = true;
      console.warn("TURNSTILE_SECRET_KEY is not set, so bot checks on sign-up, sign-in and checkout are off.");
    }
    return true;
  }
  if (!token) return false;

  try {
    const res = await (opts.fetch ?? fetch)(SITEVERIFY, {
      method: "POST",
      body: new URLSearchParams({ secret, response: token, ...(opts.remoteIp ? { remoteip: opts.remoteIp } : {}) }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { success?: unknown };
    return body.success === true;
  } catch (err) {
    // The message of a network error can echo the request, so log only what kind of failure it was.
    console.error("turnstile verification failed:", err instanceof Error ? err.name : "unknown error");
    return false;
  }
}
