import { and, eq, lt, sql } from "drizzle-orm";
import { restaurantConfig } from "../../config/restaurant";
import type { RestaurantConfig } from "../../config/schema";
import { requireRole } from "@/auth/session";
import { withRequestContext, withSystemContext, type RequestContext, type Tx } from "@/db/context";
import { agentConfigs, agentProposals, agentRuns, auditLog } from "@/db/schema";
import { effectiveMode, type Autonomy, type Mode } from "@/domain/agents/rules";
import { providers } from "@/providers";
import type { LLMProvider } from "@/providers/llm/types";
import type { NotificationProvider } from "@/providers/notification/types";
import { CapExceededError, budgetedLLM } from "./llm";
import { getAgent, getExecutor } from "./registry";
import type { ProposalDraft } from "./types";

// Running agents, storing what they propose, and carrying proposals out after the decision. The only place that
// turns an agent's wish into an effect. Every run, decision and execution writes audit_log.

export type FrameworkDeps = {
  systemUrl?: string;
  appUrl?: string;
  now?: Date;
  config?: RestaurantConfig;
  /** Resolved only when a run asks for a model. */
  llm?: LLMProvider;
  /** Resolved only when an executor is about to send. */
  notifications?: NotificationProvider;
};

export class ProposalNotDecidableError extends Error {}
export class AgentOffError extends Error {}

const FOURTEEN_DAYS = 14 * 86_400_000;
const short = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

export type AgentConfig = {
  agentKey: string;
  enabled: boolean;
  autonomy: Autonomy;
  /** An owner has separately confirmed that customer-facing proposals may be sent without approval. */
  autoConfirmed: boolean;
  /** Null means the restaurant-wide default. */
  monthlyCapMinor: number | null;
  settings: Record<string, unknown>;
};

/** An agent's saved config, or the safe defaults (off, suggest-only) when nothing is saved. */
export async function getAgentConfig(key: string, deps: FrameworkDeps = {}, tx?: Tx): Promise<AgentConfig> {
  const read = async (t: Tx) => {
    const [row] = await t.select().from(agentConfigs).where(eq(agentConfigs.agentKey, key));
    return {
      agentKey: key,
      enabled: row?.enabled ?? false,
      autonomy: (row?.autonomy ?? "suggest_only") as Autonomy,
      autoConfirmed: !!row?.autoConfirmedAt,
      monthlyCapMinor: row?.monthlyCapMinor ?? null,
      settings: (row?.settings ?? {}) as Record<string, unknown>,
    };
  };
  return tx ? read(tx) : withSystemContext(read, { url: deps.systemUrl });
}

const audit = (tx: Tx, who: { id?: string; role: string }, action: string, target: string, meta: Record<string, unknown> = {}) =>
  tx.insert(auditLog).values({ actorId: who.id ?? null, actorRole: who.role, action, targetType: "agent", targetId: target, meta });

export type RunResult = { runId: string; status: "succeeded" | "failed" | "refused_cap" | "skipped"; proposalIds: string[]; error?: string };

/**
 * Runs an agent once. It returns proposals; here they are checked, stored in the mode the agent's autonomy calls
 * for, and any that are set to run automatically are carried out. A run that fails, or is refused by the cap,
 * stores nothing and says why.
 */
export async function runAgent(key: string, options: { trigger: "schedule" | "manual" | "inbound"; startedBy?: string; input?: unknown } = { trigger: "manual" }, deps: FrameworkDeps = {}): Promise<RunResult> {
  const agent = getAgent(key);
  const now = deps.now ?? new Date();
  const config = deps.config ?? restaurantConfig;
  const url = { url: deps.systemUrl };
  const cfg = await getAgentConfig(key, deps);

  const [run] = await withSystemContext((tx) => tx.insert(agentRuns).values({ agentKey: key, trigger: options.trigger, startedBy: options.startedBy ?? null, startedAt: now }).returning({ id: agentRuns.id }), url);

  const finish = async (status: RunResult["status"], extra: { error?: string; proposals?: number } = {}) => {
    await withSystemContext(async (tx) => {
      const [done] = await tx
        .update(agentRuns)
        .set({ status, finishedAt: new Date(), error: extra.error ?? null, proposals: extra.proposals ?? 0 })
        .where(eq(agentRuns.id, run.id))
        .returning({ cost: agentRuns.costMinor });
      await audit(tx, { id: options.startedBy, role: options.startedBy ? "staff" : "system" }, "agent.run", key, { runId: run.id, status, trigger: options.trigger, proposals: extra.proposals ?? 0, costMinor: done?.cost ?? 0, ...(extra.error ? { error: extra.error } : {}) });
    }, url);
  };

  if (!cfg.enabled) {
    await finish("skipped", { error: "The agent is switched off" });
    return { runId: run.id, status: "skipped", proposalIds: [], error: "The agent is switched off" };
  }

  let drafts: ProposalDraft[];
  try {
    const settings = agent.settingsSchema.parse({ ...(agent.defaultSettings as object), ...cfg.settings });
    const capMinor = cfg.monthlyCapMinor ?? config.agents.defaultMonthlyCapMinor;
    drafts = await agent.run({
      now,
      config,
      settings,
      input: options.input,
      llm: {
        complete: (request) => budgetedLLM(run.id, key, capMinor, { provider: deps.llm ?? providers().llm, config, now, systemUrl: deps.systemUrl }).complete(request),
      },
      read: (fn) =>
        withSystemContext(async (tx) => {
          // From here this transaction cannot write: an agent reads, it does not change anything.
          await tx.execute(sql`select set_config('transaction_read_only', 'on', true)`);
          return fn(tx);
        }, url),
    });
    // Every proposal must be something the framework knows how to carry out, with a payload that fits.
    for (const d of drafts) getExecutor(d.kind).payloadSchema.parse(d.payload);
  } catch (err) {
    const status = err instanceof CapExceededError ? "refused_cap" : "failed";
    await finish(status, { error: short(err) });
    return { runId: run.id, status, proposalIds: [], error: short(err) };
  }

  const stored = await withSystemContext(async (tx) => {
    const out: { id: string; mode: Mode }[] = [];
    for (const d of drafts) {
      const mode = effectiveMode(cfg.autonomy, d.customerFacing, cfg.autoConfirmed);
      const [row] = await tx
        .insert(agentProposals)
        .values({ runId: run.id, agentKey: key, kind: d.kind, summary: d.summary.slice(0, 500), payload: d.payload as object, customerFacing: d.customerFacing, mode, dedupeKey: d.dedupeKey ?? null, createdAt: now, expiresAt: d.expiresAt ?? new Date(now.getTime() + FOURTEEN_DAYS) })
        .onConflictDoNothing()
        .returning({ id: agentProposals.id });
      if (row) out.push({ id: row.id, mode });
    }
    return out;
  }, url);

  await finish("succeeded", { proposals: stored.length });
  for (const p of stored) if (p.mode === "auto") await executeProposal(p.id, deps);
  return { runId: run.id, status: "succeeded", proposalIds: stored.map((p) => p.id) };
}

/**
 * Carries a proposal out: one that was approved, or one made to run automatically. Idempotent: a proposal that
 * has been executed is left alone, and two callers at once execute it once. A failure is kept on the proposal.
 */
export async function executeProposal(id: string, deps: FrameworkDeps = {}): Promise<"executed" | "failed" | "skipped"> {
  const now = deps.now ?? new Date();
  const config = deps.config ?? restaurantConfig;
  return withSystemContext(
    async (tx) => {
      const [p] = await tx.select().from(agentProposals).where(eq(agentProposals.id, id)).for("update");
      if (!p) throw new ProposalNotDecidableError("Proposal not found");
      const ready = p.status === "approved" || (p.status === "pending" && p.mode === "auto");
      if (!ready) return "skipped";
      try {
        const executor = getExecutor(p.kind);
        const payload = executor.payloadSchema.parse(p.payload);
        const result = await executor.execute(payload, { now, config, notifications: deps.notifications ?? providers().notification }, tx);
        await tx.update(agentProposals).set({ status: "executed", executedAt: now, result: (result ?? {}) as object, error: null }).where(eq(agentProposals.id, id));
        await audit(tx, { role: "system" }, "agent.proposal.executed", p.agentKey, { proposalId: id, kind: p.kind });
        return "executed";
      } catch (err) {
        await tx.update(agentProposals).set({ status: "failed", error: short(err) }).where(eq(agentProposals.id, id));
        await audit(tx, { role: "system" }, "agent.proposal.failed", p.agentKey, { proposalId: id, kind: p.kind, error: short(err) });
        return "failed";
      }
    },
    { url: deps.systemUrl },
  );
}

/** A manager or owner approves or rejects a pending proposal. Approving carries it out. Advice can only be dismissed. */
export async function decideProposal(ctx: RequestContext, id: string, approve: boolean, deps: FrameworkDeps = {}): Promise<"executed" | "failed" | "rejected"> {
  requireRole(ctx, ["owner", "manager"]);
  const done = await withRequestContext(
    ctx,
    async (tx) => {
      const rows = await tx
        .update(agentProposals)
        .set({ status: approve ? "approved" : "rejected", decidedBy: ctx.userId, decidedAt: new Date() })
        .where(and(eq(agentProposals.id, id), eq(agentProposals.status, "pending")))
        .returning({ agentKey: agentProposals.agentKey, kind: agentProposals.kind });
      if (rows.length === 0) return null;
      await audit(tx, { id: ctx.userId, role: ctx.role }, approve ? "agent.proposal.approved" : "agent.proposal.rejected", rows[0].agentKey, { proposalId: id, kind: rows[0].kind });
      return rows[0];
    },
    { url: deps.appUrl },
  ).catch((err) => {
    // The policy refuses approving plain advice: that is the same as not being decidable.
    if ((err as { cause?: { code?: string } })?.cause?.code === "42501") return null;
    throw err;
  });
  if (!done) throw new ProposalNotDecidableError("That proposal cannot be decided: it is not waiting, or it is advice that can only be dismissed");
  if (!approve) return "rejected";
  const outcome = await executeProposal(id, deps);
  return outcome === "failed" ? "failed" : "executed";
}

/** Proposals nobody decided in time are closed, so an old suggestion is never acted on by surprise. */
export async function expireProposals(deps: FrameworkDeps = {}): Promise<number> {
  const now = deps.now ?? new Date();
  return withSystemContext(
    async (tx) => (await tx.update(agentProposals).set({ status: "expired" }).where(and(eq(agentProposals.status, "pending"), lt(agentProposals.expiresAt, now))).returning({ id: agentProposals.id })).length,
    { url: deps.systemUrl },
  );
}
