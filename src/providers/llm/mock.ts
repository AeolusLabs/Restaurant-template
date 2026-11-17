import type { LLMProvider, LLMRequest, LLMUsage } from "./types";

const tokens = (text: string) => Math.ceil(text.length / 4);

/** Returns whatever it was told to (respondWith), validated against the caller's schema. No network. */
export class MockLLMProvider implements LLMProvider {
  private canned: unknown = {};

  respondWith(output: unknown): void {
    this.canned = output;
  }

  async complete<T>(request: LLMRequest<T>): Promise<{ output: T; usage: LLMUsage }> {
    const output = request.schema.parse(this.canned);
    const input = request.system + request.messages.map((m) => m.content).join("");
    return {
      output,
      usage: { inputTokens: tokens(input), outputTokens: Math.min(tokens(JSON.stringify(output)), request.maxOutputTokens) },
    };
  }
}
