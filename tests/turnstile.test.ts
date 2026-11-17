import { describe, expect, test, vi } from "vitest";
import { verifyTurnstile } from "../src/lib/turnstile";

const SECRET = "0x4AAAAAAA_not_a_real_secret";
type Call = { url: string; method?: string; body: URLSearchParams };

function fake(reply: () => Response | Error) {
  const calls: Call[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method, body: new URLSearchParams(String(init?.body)) });
    const r = reply();
    if (r instanceof Error) throw r;
    return r;
  }) as typeof fetch;
  return { fn, calls };
}
const ok = (success: boolean) => new Response(JSON.stringify({ success }), { status: 200, headers: { "content-type": "application/json" } });

describe("verifyTurnstile", () => {
  test("asks Cloudflare to check the token, with the secret and the visitor's address", async () => {
    const { fn, calls } = fake(() => ok(true));
    expect(await verifyTurnstile("tok-123", { secret: SECRET, remoteIp: "203.0.113.9", fetch: fn })).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(calls[0].method).toBe("POST");
    expect(Object.fromEntries(calls[0].body)).toEqual({ secret: SECRET, response: "tok-123", remoteip: "203.0.113.9" });
  });

  test("a token Cloudflare rejects is refused", async () => {
    expect(await verifyTurnstile("bad", { secret: SECRET, fetch: fake(() => ok(false)).fn })).toBe(false);
  });

  test("a missing or empty token is refused without calling Cloudflare", async () => {
    const { fn, calls } = fake(() => ok(true));
    expect(await verifyTurnstile("", { secret: SECRET, fetch: fn })).toBe(false);
    expect(await verifyTurnstile(undefined, { secret: SECRET, fetch: fn })).toBe(false);
    expect(calls).toHaveLength(0);
  });

  test("fails closed when Cloudflare cannot be reached, answers badly or sends nonsense", async () => {
    for (const reply of [() => new Error("ECONNREFUSED"), () => new Response("oops", { status: 500 }), () => new Response("not json", { status: 200 }), () => new Response(JSON.stringify({ ok: true }), { status: 200 })]) {
      expect(await verifyTurnstile("tok", { secret: SECRET, fetch: fake(reply).fn })).toBe(false);
    }
  });

  test("without a secret the check is switched off, and says so once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { fn, calls } = fake(() => ok(false));
    expect(await verifyTurnstile("anything", { secret: undefined, fetch: fn })).toBe(true);
    expect(await verifyTurnstile(undefined, { secret: "", fetch: fn })).toBe(true);
    expect(calls).toHaveLength(0);
    expect(warn.mock.calls.length).toBeLessThanOrEqual(1);
    warn.mockRestore();
  });

  test("the secret never appears in what is logged on failure", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await verifyTurnstile("tok", { secret: SECRET, fetch: fake(() => new Error(`failed for ${SECRET}`)).fn });
    expect(JSON.stringify(err.mock.calls)).not.toContain(SECRET);
    err.mockRestore();
  });
});
