import type { Agent, Executor } from "./types";

// Which agents exist and how each kind of proposal is carried out. Kept on globalThis so every route bundle and
// development reloads share one registry.

type Registry = { agents: Map<string, Agent<never, never>>; executors: Map<string, Executor<never>> };
const holder = globalThis as typeof globalThis & { __agentRegistry?: Registry };
const registry = (): Registry => (holder.__agentRegistry ??= { agents: new Map(), executors: new Map() });

export class UnknownAgentError extends Error {}
export class UnknownKindError extends Error {}

export function registerAgent<S, I>(agent: Agent<S, I>): void {
  registry().agents.set(agent.key, agent as unknown as Agent<never, never>);
}
export function registerExecutor<P>(executor: Executor<P>): void {
  registry().executors.set(executor.kind, executor as unknown as Executor<never>);
}

export function getAgent(key: string): Agent<unknown, unknown> {
  const a = registry().agents.get(key);
  if (!a) throw new UnknownAgentError(`No agent called ${key}`);
  return a as unknown as Agent<unknown, unknown>;
}
export const listAgents = (): Agent<unknown, unknown>[] => [...registry().agents.values()] as unknown as Agent<unknown, unknown>[];

export function getExecutor(kind: string): Executor<unknown> {
  const e = registry().executors.get(kind);
  if (!e) throw new UnknownKindError(`Nothing carries out proposals of kind ${kind}`);
  return e as unknown as Executor<unknown>;
}

/** For tests: forget everything registered. */
export function clearRegistry(): void {
  registry().agents.clear();
  registry().executors.clear();
}
