// The global safety net: strips known-sensitive keys from every JSON response, at any depth, so a
// handler that forgets to use the serializers in sanitize.ts still cannot leak a hash or a token.
// Compared after lower-casing and removing "_" and "-", so passwordHash, password_hash and
// PASSWORD-HASH are the same key. Better Auth's own routes are not wrapped: their responses
// legitimately carry session data.

export const SENSITIVE_KEYS: readonly string[] = [
  "password",
  "passwordhash",
  "hash",
  "token",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "resettoken",
  "verificationtoken",
  "apikey",
  "secret",
  "clientsecret",
];

const sensitive = new Set(SENSITIVE_KEYS);
const normalise = (key: string) => key.toLowerCase().replace(/[_-]/g, "");

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** Returns a copy of value without any sensitive key. Never mutates the input. */
export function scrubValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubValue);
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (!sensitive.has(normalise(key))) out[key] = scrubValue(v);
  }
  return out;
}

type Handler<A extends unknown[]> = (...args: A) => Promise<Response>;

/** Wraps a route handler so its application/json responses are scrubbed. Streams pass through untouched. */
export function withScrub<A extends unknown[]>(handler: Handler<A>): Handler<A> {
  return async (...args: A) => {
    const res = await handler(...args);
    if (!/application\/json/i.test(res.headers.get("content-type") ?? "") || res.body === null) return res;
    const text = await res.clone().text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return res;
    }
    const headers = new Headers(res.headers);
    headers.delete("content-length");
    return new Response(JSON.stringify(scrubValue(parsed)), { status: res.status, statusText: res.statusText, headers });
  };
}
