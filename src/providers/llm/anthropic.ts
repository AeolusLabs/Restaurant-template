import { z } from "zod";
import { LLMProviderError, type LLMProvider, type LLMRequest, type LLMUsage } from "./types";

// Anthropic adapter. The only file that knows Anthropic's field names; everything above it speaks the LLMProvider
// interface. Written from the Messages API as documented and covered by contract tests against a fake fetch only.
// NOT yet confirmed against the live API: do that with a real key before launch. It asks for one JSON object and
// checks it against the caller's schema: it never guesses at an answer, and a reply without token counts is an error
// because the cost could not be counted (the spend cap depends on it).

const BASE_URL = "https://api.anthropic.com";
const VERSION = "2023-06-01";
const TIMEOUT_MS = 60_000;

export type AnthropicOptions = { apiKey: string; model: string; baseUrl?: string; fetch?: typeof fetch };

const count = z.number().int().nonnegative();
const response = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() }).loose()),
  stop_reason: z.string().nullable().optional(),
  usage: z.object({ input_tokens: count, output_tokens: count }),
});

/** The JSON object in a reply: bare, inside a code fence, or after a line of chat. */
function jsonIn(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new LLMProviderError("The model's answer was not JSON");
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new LLMProviderError("The model's answer was not valid JSON");
  }
}

export class AnthropicProvider implements LLMProvider {
  readonly model: string;
  private readonly key: string;
  private readonly baseUrl: string;
  private readonly http: typeof fetch;

  constructor(opts: AnthropicOptions) {
    if (!opts.apiKey) throw new Error("AnthropicProvider needs an API key (ANTHROPIC_API_KEY)");
    if (!opts.model) throw new Error("AnthropicProvider needs a model (ANTHROPIC_MODEL)");
    this.key = opts.apiKey;
    this.model = opts.model;
    this.baseUrl = (opts.baseUrl || BASE_URL).replace(/\/+$/, "");
    this.http = opts.fetch ?? fetch;
  }

  async complete<T>(request: LLMRequest<T>): Promise<{ output: T; usage: LLMUsage }> {
    const shape = JSON.stringify(z.toJSONSchema(request.schema));
    const system = `${request.system}\n\nAnswer with a single JSON object and nothing else, matching this JSON Schema: ${shape}`;
    let res: Response;
    try {
      res = await this.http(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: { "x-api-key": this.key, "anthropic-version": VERSION, "content-type": "application/json" },
        body: JSON.stringify({ model: this.model, max_tokens: request.maxOutputTokens, system, messages: request.messages }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new LLMProviderError("The model could not be reached");
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new LLMProviderError(`The model returned an unreadable response (HTTP ${res.status})`);
    }
    if (!res.ok) {
      const message = (json as { error?: { message?: unknown } })?.error?.message;
      throw new LLMProviderError(`The model refused the request (HTTP ${res.status}): ${typeof message === "string" ? message : "no reason given"}`);
    }
    const parsed = response.safeParse(json);
    if (!parsed.success) throw new LLMProviderError("The model returned an unexpected response (or one without token counts)");
    if (parsed.data.stop_reason === "max_tokens") throw new LLMProviderError("The model's answer was cut off by the token limit");
    const text = parsed.data.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
    const checked = request.schema.safeParse(jsonIn(text));
    if (!checked.success) throw new LLMProviderError("The model's answer did not fit the expected shape");
    return { output: checked.data, usage: { inputTokens: parsed.data.usage.input_tokens, outputTokens: parsed.data.usage.output_tokens } };
  }
}
