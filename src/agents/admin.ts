import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { restaurantConfig } from "../../config/restaurant";
import { requireRole } from "@/auth/session";
import { withRequestContext, type RequestContext } from "@/db/context";
import { agentConfigs, agentProposals, agentRuns, auditLog } from "@/db/schema";
import { monthWindow, type Autonomy } from "@/domain/agents/rules";
import type { AgentFormValue } from "./settings-form";
import { getAgent, listAgents } from "./registry";
import type { FrameworkDeps } from "./framework";

// What the admin agent screens read and write. Managers and owners look and decide; only owners change an agent's
// settings. Everything runs as the signed-in person, so row-level security says the same. Changes write audit_log.

export class AgentConfigError extends Error {}

export type AgentOverview = {
  key: string;
  title: string;
  description: string;
  reactive: boolean;
  enabled: boolean;
  autonomy: Autonomy;
  autoConfirmed: boolean;
  settings: Record<string, unknown>;
  /** The cap in force: the agent's own, or the restaurant's default. */
  capMinor: number;
  usingDefaultCap: boolean;
  spentMinor: number;
  pending: number;
  lastRun: { status: string; startedAt: Date; costMinor: number } | null;
};

/** Every agent with its state, this month's spend, how many proposals wait, and its last run. */
export async function agentOverview(ctx: RequestContext, deps: FrameworkDeps = {}): Promise<AgentOverview[]> {
  requireRole(ctx, ["owner", "manager"]);
  const config = deps.config ?? restaurantConfig;
  const month = monthWindow(deps.now ?? new Date(), config.timezone);
  return withRequestContext(
    ctx,
    async (tx) => {
      const out: AgentOverview[] = [];
      for (const agent of listAgents()) {
        const [cfg] = await tx.select().from(agentConfigs).where(eq(agentConfigs.agentKey, agent.key));
        const [spent] = await tx
          .select({ total: sql<number>`coalesce(sum(${agentRuns.costMinor}), 0)`.mapWith(Number) })
          .from(agentRuns)
          .where(and(eq(agentRuns.agentKey, agent.key), gte(agentRuns.startedAt, month.start), lt(agentRuns.startedAt, month.end)));
        const [waiting] = await tx
          .select({ n: sql<number>`count(*)`.mapWith(Number) })
          .from(agentProposals)
          .where(and(eq(agentProposals.agentKey, agent.key), eq(agentProposals.status, "pending")));
        const [last] = await tx.select().from(agentRuns).where(eq(agentRuns.agentKey, agent.key)).orderBy(desc(agentRuns.startedAt)).limit(1);
        out.push({
          key: agent.key,
          title: agent.title,
          description: agent.description,
          reactive: !!agent.reactive,
          enabled: cfg?.enabled ?? false,
          autonomy: (cfg?.autonomy ?? "suggest_only") as Autonomy,
          autoConfirmed: !!cfg?.autoConfirmedAt,
          settings: { ...(agent.defaultSettings as object), ...((cfg?.settings ?? {}) as object) },
          capMinor: cfg?.monthlyCapMinor ?? config.agents.defaultMonthlyCapMinor,
          usingDefaultCap: cfg?.monthlyCapMinor == null,
          spentMinor: spent?.total ?? 0,
          pending: waiting?.n ?? 0,
          lastRun: last ? { status: last.status, startedAt: last.startedAt, costMinor: last.costMinor } : null,
        });
      }
      return out;
    },
    { url: deps.appUrl },
  );
}

/** An owner saves an agent's settings. Moving it off `auto` takes back any confirmation to send on its own. */
export async function saveAgentConfig(ctx: RequestContext, key: string, value: AgentFormValue, deps: FrameworkDeps = {}): Promise<void> {
  requireRole(ctx, ["owner"]);
  const agent = getAgent(key);
  if (value.monthlyCapMinor !== null && (!Number.isSafeInteger(value.monthlyCapMinor) || value.monthlyCapMinor < 0)) throw new AgentConfigError("The cap must be zero or more");
  const parsed = agent.settingsSchema.safeParse({ ...(agent.defaultSettings as object), ...value.settings });
  if (!parsed.success) throw new AgentConfigError("Those settings do not fit this agent");
  await withRequestContext(
    ctx,
    async (tx) => {
      const fields = { enabled: value.enabled, autonomy: value.autonomy, monthlyCapMinor: value.monthlyCapMinor, settings: parsed.data as object, updatedBy: ctx.userId, updatedAt: new Date() };
      const clear = value.autonomy === "auto" ? {} : { autoConfirmedAt: null, autoConfirmedBy: null };
      await tx
        .insert(agentConfigs)
        .values({ agentKey: key, ...fields })
        .onConflictDoUpdate({ target: agentConfigs.agentKey, set: { ...fields, ...clear } });
      await tx.insert(auditLog).values({ actorId: ctx.userId, actorRole: ctx.role, action: "agent.config.updated", targetType: "agent", targetId: key, meta: { enabled: value.enabled, autonomy: value.autonomy, capMinor: value.monthlyCapMinor } });
    },
    { url: deps.appUrl },
  );
}

/**
 * An owner's separate confirmation that this agent may send things customers will read without anyone approving
 * them. It needs the agent to be on `auto` and the word SEND typed. Taking it back needs nothing.
 */
export async function setAutoConfirmation(ctx: RequestContext, key: string, confirm: boolean, typed: string, deps: FrameworkDeps = {}): Promise<void> {
  requireRole(ctx, ["owner"]);
  getAgent(key);
  await withRequestContext(
    ctx,
    async (tx) => {
      const [cfg] = await tx.select().from(agentConfigs).where(eq(agentConfigs.agentKey, key)).for("update");
      if (confirm) {
        if (!cfg || cfg.autonomy !== "auto") throw new AgentConfigError("Set the agent to Automatic first");
        if (typed.trim() !== "SEND") throw new AgentConfigError("Type SEND to confirm");
      }
      if (!cfg) return;
      await tx.update(agentConfigs).set(confirm ? { autoConfirmedAt: new Date(), autoConfirmedBy: ctx.userId } : { autoConfirmedAt: null, autoConfirmedBy: null }).where(eq(agentConfigs.agentKey, key));
      await tx.insert(auditLog).values({ actorId: ctx.userId, actorRole: ctx.role, action: confirm ? "agent.auto_send.confirmed" : "agent.auto_send.revoked", targetType: "agent", targetId: key });
    },
    { url: deps.appUrl },
  );
}

export type ProposalRow = {
  id: string;
  agentKey: string;
  kind: string;
  summary: string;
  customerFacing: boolean;
  mode: string;
  status: string;
  error: string | null;
  createdAt: Date;
  decidedAt: Date | null;
};

/** Proposals waiting for a decision (newest first), or the most recent ones that have been dealt with. */
export async function listProposals(ctx: RequestContext, which: "waiting" | "recent", deps: FrameworkDeps = {}): Promise<ProposalRow[]> {
  requireRole(ctx, ["owner", "manager"]);
  const rows = await withRequestContext(
    ctx,
    (tx) =>
      tx
        .select()
        .from(agentProposals)
        .where(which === "waiting" ? eq(agentProposals.status, "pending") : sql`${agentProposals.status} <> 'pending'`)
        .orderBy(desc(agentProposals.createdAt), desc(agentProposals.id))
        .limit(100),
    { url: deps.appUrl },
  );
  return rows.map((p) => ({ id: p.id, agentKey: p.agentKey, kind: p.kind, summary: p.summary, customerFacing: p.customerFacing, mode: p.mode, status: p.status, error: p.error, createdAt: p.createdAt, decidedAt: p.decidedAt }));
}

export type RunRow = { id: string; agentKey: string; trigger: string; status: string; startedAt: Date; costMinor: number; proposals: number; error: string | null };

export async function listRuns(ctx: RequestContext, limit: number, deps: FrameworkDeps = {}): Promise<RunRow[]> {
  requireRole(ctx, ["owner", "manager"]);
  const rows = await withRequestContext(ctx, (tx) => tx.select().from(agentRuns).orderBy(desc(agentRuns.startedAt)).limit(Math.min(limit, 200)), { url: deps.appUrl });
  return rows.map((r) => ({ id: r.id, agentKey: r.agentKey, trigger: r.trigger, status: r.status, startedAt: r.startedAt, costMinor: r.costMinor, proposals: r.proposals, error: r.error }));
}
