import type { ZodType } from "zod";

export type LLMMessage = { role: "user" | "assistant"; content: string };
export type LLMUsage = { inputTokens: number; outputTokens: number };

export type LLMRequest<T> = {
  system: string;
  messages: LLMMessage[];
  /** The output must parse with this schema, or the call fails. */
  schema: ZodType<T>;
  maxOutputTokens: number;
};

/**
 * The only way agents reach a model, so the monthly spend cap can count every call.
 * Each call reports its token usage; cost is computed from the price table in config.
 */
export interface LLMProvider {
  /** The model's name, which is the key into the price table (config agents.modelPrices). */
  readonly model: string;
  complete<T>(request: LLMRequest<T>): Promise<{ output: T; usage: LLMUsage }>;
}

/** A model call failed: refused, unreachable, cut off, or an answer that does not fit the schema. */
export class LLMProviderError extends Error {}
