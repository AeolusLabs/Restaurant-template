import type { ZodType } from "zod";
import type { RestaurantConfig } from "../../config/schema";
import type { Tx } from "@/db/context";
import type { LLMProvider } from "@/providers/llm/types";
import type { NotificationProvider } from "@/providers/notification/types";

// The agent contract. An agent reads and returns proposals; it never sends, writes or changes anything itself.
// The framework (framework.ts) stores the proposals and, after the decision their mode calls for, runs the
// executor registered for their kind. See docs/ARCHITECTURE.md section 15.

/** What an agent wants done. `summary` is for the person deciding, in plain words. */
export type ProposalDraft = {
  kind: string;
  summary: string;
  payload: unknown;
  /** True when a customer will read the outcome (a message). Such proposals are never sent automatically without an owner's confirmation. */
  customerFacing: boolean;
  /** Never carried out without a person's approval, whatever the agent's autonomy or confirmations. For decisions that must be a person's (blocking someone). */
  neverAuto?: boolean;
  /** At most one open proposal per agent and key. */
  dedupeKey?: string;
  expiresAt?: Date;
};

export type AgentContext<S, I> = {
  /** The key this agent is registered and saved under. */
  agentKey: string;
  now: Date;
  config: RestaurantConfig;
  settings: S;
  /** What triggered the run, for an agent that reacts (an inbound message). */
  input: I | undefined;
  /** The only way to reach a model. Refuses a call that would pass this agent's monthly cap. */
  llm: Pick<LLMProvider, "complete">;
  /** Reads the database. The transaction is read-only, so an agent cannot change anything through it. */
  read<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
};

export type Agent<S = unknown, I = unknown> = {
  key: string;
  title: string;
  description: string;
  /** Checked when a manager saves the agent's settings, and when it runs. */
  settingsSchema: ZodType<S>;
  defaultSettings: S;
  /** True when the agent is started by something arriving (a message), not by the clock. */
  reactive?: boolean;
  /** How often the worker runs it, for an agent that runs on the clock. */
  schedule?: { everyMs: number };
  run(ctx: AgentContext<S, I>): Promise<ProposalDraft[]>;
};

export type ExecutorDeps = { now: Date; config: RestaurantConfig; notifications: NotificationProvider };

/** The one place a kind of proposal is carried out. Runs inside a system transaction, after the decision. */
export type Executor<P = unknown> = {
  kind: string;
  payloadSchema: ZodType<P>;
  execute(payload: P, deps: ExecutorDeps, tx: Tx): Promise<unknown>;
};
