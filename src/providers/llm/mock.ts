import type { LLMProvider, LLMRequest, LLMUsage } from "./types";

const tokens = (text: string) => Math.ceil(text.length / 4);

/** Returns whatever it was told to (respondWith), validated against the caller's schema. No network. */
export class MockLLMProvider implements LLMProvider {
  private canned: unknown = {};
  /** Every request it was asked, for tests. */
  readonly requests: LLMRequest<unknown>[] = [];
  constructor(readonly model = "mock-model") {}
  private failure: Error | null = null;

  /** Test hook: the next call fails once, like a provider outage. */
  failNext(error = new Error("mock model failure")): void {
    this.failure = error;
  }

  respondWith(output: unknown): void {
    this.canned = output;
  }

  async complete<T>(request: LLMRequest<T>): Promise<{ output: T; usage: LLMUsage }> {
    this.requests.push(request as LLMRequest<unknown>);
    if (this.failure) {
      const e = this.failure;
      this.failure = null;
      throw e;
    }
    const output = request.schema.parse(this.canned);
    const input = request.system + request.messages.map((m) => m.content).join("");
    return {
      output,
      usage: { inputTokens: tokens(input), outputTokens: Math.min(tokens(JSON.stringify(output)), request.maxOutputTokens) },
    };
  }
}
