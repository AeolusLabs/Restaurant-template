import { z } from "zod";
import { describe, expect, test } from "vitest";
import { AnthropicProvider } from "../src/providers/llm/anthropic";
import { LLMProviderError } from "../src/providers/llm/types";

// Contract tests against a fake fetch. Nothing here has touched the real Anthropic API: the request and response
// shapes are written from the Messages API as documented, and must be confirmed with a real key before launch.

const KEY = "sk-ant-not-a-real-key-1234567890";
const MODEL = "claude-test-model";
type Call = { url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> };

function fakeFetch(respond: (call: Call) => { status?: number; json: unknown } | Error) {
  const calls: Call[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    const call: Call = { url: String(url), method: init?.method ?? "GET", headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)), body: JSON.parse(String(init?.body ?? "{}")) };
    calls.push(call);
    const r = respond(call);
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fn, calls };
}
const provider = (f: typeof fetch, over: Partial<ConstructorParameters<typeof AnthropicProvider>[0]> = {}) => new AnthropicProvider({ apiKey: KEY, model: MODEL, fetch: f, ...over });
const reply = (text: string, over: Record<string, unknown> = {}) => ({ json: { id: "msg_1", type: "message", role: "assistant", model: MODEL, content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 120, output_tokens: 30 }, ...over } });
const schema = z.object({ reply: z.string(), needsHuman: z.boolean() });
const ask = (p: AnthropicProvider) => p.complete({ system: "You are helpful.", messages: [{ role: "user", content: "Are you open?" }], schema, maxOutputTokens: 200 });

describe("set-up", () => {
  test("needs a key and a model", () => {
    const { fn } = fakeFetch(() => reply("{}"));
    expect(() => new AnthropicProvider({ apiKey: "", model: MODEL, fetch: fn })).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => new AnthropicProvider({ apiKey: KEY, model: "", fetch: fn })).toThrow(/ANTHROPIC_MODEL/);
  });
  test("reports its model, which is the key into the price table", () => {
    expect(provider(fakeFetch(() => reply("{}")).fn).model).toBe(MODEL);
  });
});

describe("the request", () => {
  test("posts to the messages endpoint with the key, the API version, the model, the token limit and the conversation", async () => {
    const { fn, calls } = fakeFetch(() => reply('{"reply":"Yes, from 10:00.","needsHuman":false}'));
    await ask(provider(fn));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: "https://api.anthropic.com/v1/messages", method: "POST" });
    expect(calls[0].headers["x-api-key"]).toBe(KEY);
    expect(calls[0].headers["anthropic-version"]).toBe("2023-06-01");
    expect(calls[0].body).toMatchObject({ model: MODEL, max_tokens: 200, messages: [{ role: "user", content: "Are you open?" }] });
  });

  test("tells the model to answer with one JSON object that fits the caller's schema, after the caller's own instructions", async () => {
    const { fn, calls } = fakeFetch(() => reply('{"reply":"x","needsHuman":false}'));
    await ask(provider(fn));
    const system = String(calls[0].body.system);
    expect(system.startsWith("You are helpful.")).toBe(true);
    expect(system).toMatch(/JSON/);
    expect(system).toContain("needsHuman");
  });

  test("a different base address is honoured, trailing slash or not", async () => {
    const { fn, calls } = fakeFetch(() => reply('{"reply":"x","needsHuman":false}'));
    await ask(provider(fn, { baseUrl: "https://proxy.example.test/" }));
    expect(calls[0].url).toBe("https://proxy.example.test/v1/messages");
  });
});

describe("the answer", () => {
  test("is the parsed output, with the token counts the provider reported", async () => {
    const { fn } = fakeFetch(() => reply('{"reply":"Yes, from 10:00.","needsHuman":false}'));
    expect(await ask(provider(fn))).toEqual({ output: { reply: "Yes, from 10:00.", needsHuman: false }, usage: { inputTokens: 120, outputTokens: 30 } });
  });

  test("JSON inside a code fence, or after a line of chat, is still read", async () => {
    for (const text of ['```json\n{"reply":"ok","needsHuman":false}\n```', 'Sure! {"reply":"ok","needsHuman":false}', '{"reply":"ok","needsHuman":false}\n']) {
      const { fn } = fakeFetch(() => reply(text));
      expect((await ask(provider(fn))).output).toEqual({ reply: "ok", needsHuman: false });
    }
  });

  test("text spread over several blocks is joined", async () => {
    const { fn } = fakeFetch(() => ({ json: { content: [{ type: "text", text: '{"reply":"ok",' }, { type: "text", text: '"needsHuman":true}' }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } } }));
    expect((await ask(provider(fn))).output).toEqual({ reply: "ok", needsHuman: true });
  });

  test("an answer that is not JSON, or does not fit the schema, is an error and never a guess", async () => {
    for (const text of ["I would be happy to help!", '{"reply":"ok"}', '{"reply":5,"needsHuman":false}', ""]) {
      const { fn } = fakeFetch(() => reply(text));
      await expect(ask(provider(fn)), text).rejects.toBeInstanceOf(LLMProviderError);
    }
  });

  test("an answer cut off by the token limit is an error, because half a JSON object is not an answer", async () => {
    const { fn } = fakeFetch(() => reply('{"reply":"ok","needsHuman":false}', { stop_reason: "max_tokens" }));
    await expect(ask(provider(fn))).rejects.toThrow(/cut off/);
  });

  test("a reply with no token counts is an error, because the cost could not be counted", async () => {
    for (const usage of [undefined, {}, { input_tokens: 5 }, { input_tokens: -1, output_tokens: 3 }, { input_tokens: 1.5, output_tokens: 3 }]) {
      const { fn } = fakeFetch(() => reply('{"reply":"ok","needsHuman":false}', { usage }));
      await expect(ask(provider(fn)), JSON.stringify(usage)).rejects.toBeInstanceOf(LLMProviderError);
    }
  });

  test("a reply with no content at all is an error", async () => {
    const { fn } = fakeFetch(() => ({ json: { content: [], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 0 } } }));
    await expect(ask(provider(fn))).rejects.toBeInstanceOf(LLMProviderError);
  });
});

describe("failures", () => {
  test("a refusal carries the provider's message and never the key", async () => {
    const { fn } = fakeFetch(() => ({ status: 401, json: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } } }));
    const err = await ask(provider(fn)).catch((e) => e);
    expect(err).toBeInstanceOf(LLMProviderError);
    expect(err.message).toContain("invalid x-api-key");
    expect(err.message).toContain("401");
    expect(err.message).not.toContain(KEY);
  });

  test("an overloaded or unreadable reply is an error too", async () => {
    await expect(ask(provider(fakeFetch(() => ({ status: 529, json: { type: "error", error: { type: "overloaded_error", message: "Overloaded" } } })).fn))).rejects.toThrow(/Overloaded/);
    const html = (async () => new Response("<html>bad gateway</html>", { status: 502 })) as unknown as typeof fetch;
    await expect(ask(provider(html))).rejects.toBeInstanceOf(LLMProviderError);
  });

  test("an unreachable provider is an error that does not leak the key from the network error", async () => {
    const err = await ask(provider(fakeFetch(() => new Error(`connect ECONNREFUSED ${KEY}`)).fn)).catch((e) => e);
    expect(err).toBeInstanceOf(LLMProviderError);
    expect(err.message).toMatch(/could not be reached/);
    expect(err.message).not.toContain(KEY);
  });
});
