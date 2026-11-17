import { describe, expect, test } from "vitest";
import { SENSITIVE_KEYS, scrubValue, withScrub } from "../src/lib/scrub";

describe("scrubValue", () => {
  test("removes sensitive keys at any depth, including inside arrays", () => {
    const out = scrubValue({
      user: { id: 1, passwordHash: "x", profile: { resetToken: "t", name: "Ada" } },
      items: [{ id: 1, apiKey: "k" }, [{ secret: "s", ok: true }]],
      password: "p",
    });
    expect(out).toEqual({
      user: { id: 1, profile: { name: "Ada" } },
      items: [{ id: 1 }, [{ ok: true }]],
    });
  });

  test("matches PasswordHash, password_hash and PASSWORD-HASH", () => {
    expect(scrubValue({ PasswordHash: 1, password_hash: 2, "PASSWORD-HASH": 3, keep: 4 })).toEqual({ keep: 4 });
  });

  test("covers every sensitive key in the list", () => {
    for (const key of SENSITIVE_KEYS) expect(scrubValue({ [key]: "x", keep: 1 }), key).toEqual({ keep: 1 });
  });

  test("keeps non-sensitive keys, null, numbers, booleans and dates unchanged", () => {
    const when = new Date("2026-11-17T00:00:00Z");
    const input = { a: null, b: 0, c: false, d: "text", e: when, f: [], g: {} };
    const out = scrubValue(input) as typeof input;
    expect(out).toEqual(input);
    expect(out.e).toBe(when);
  });

  test("does not mutate its input", () => {
    const input = { passwordHash: "x", nested: { secret: "y" } };
    scrubValue(input);
    expect(input).toEqual({ passwordHash: "x", nested: { secret: "y" } });
  });

  test("passes primitives through", () => {
    expect(scrubValue("x")).toBe("x");
    expect(scrubValue(5)).toBe(5);
    expect(scrubValue(null)).toBeNull();
    expect(scrubValue(undefined)).toBeUndefined();
  });
});

describe("withScrub", () => {
  const call = (res: Response) => withScrub(async (_req: Request) => res)(new Request("http://localhost/x"));

  test("scrubs an application/json response and keeps its status and headers", async () => {
    const res = await call(
      new Response(JSON.stringify({ id: 1, passwordHash: "x" }), {
        status: 201,
        headers: { "content-type": "application/json; charset=utf-8", "x-keep": "yes" },
      }),
    );
    expect(res.status).toBe(201);
    expect(res.headers.get("x-keep")).toBe("yes");
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ id: 1 });
  });

  test("a scrubbed body does not carry a stale content-length", async () => {
    const body = JSON.stringify({ id: 1, passwordHash: "a-long-value-to-remove" });
    const res = await call(new Response(body, { headers: { "content-type": "application/json", "content-length": String(body.length) } }));
    const text = await res.text();
    const len = res.headers.get("content-length");
    expect(len === null || Number(len) === text.length).toBe(true);
  });

  test("returns a text/event-stream response untouched", async () => {
    const original = new Response("data: {\"passwordHash\":\"x\"}\n\n", { headers: { "content-type": "text/event-stream" } });
    const res = await call(original);
    expect(res).toBe(original);
  });

  test("returns a non-JSON body untouched", async () => {
    const original = new Response("<p>passwordHash</p>", { headers: { "content-type": "text/html" } });
    expect(await call(original)).toBe(original);
  });

  test("returns the original response when the JSON is invalid", async () => {
    const original = new Response("{not json", { headers: { "content-type": "application/json" } });
    const res = await call(original);
    expect(await res.text()).toBe("{not json");
  });

  test("passes the request and context through to the handler", async () => {
    let seen: unknown[] = [];
    const wrapped = withScrub(async (...args: unknown[]) => {
      seen = args;
      return Response.json({ ok: true });
    });
    const req = new Request("http://localhost/y");
    await wrapped(req, { params: 1 });
    expect(seen[0]).toBe(req);
    expect(seen[1]).toEqual({ params: 1 });
  });

  test("a response with no body is returned as is", async () => {
    const original = new Response(null, { status: 204, headers: { "content-type": "application/json" } });
    expect(await call(original)).toBe(original);
  });
});
