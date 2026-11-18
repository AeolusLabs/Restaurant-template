import { and, eq, max } from "drizzle-orm";
import { withSystemContext } from "@/db/context";
import { agentRuns } from "@/db/schema";
import { expireProposals, getAgentConfig, runAgent, type FrameworkDeps } from "./framework";
import { ensureAgentsRegistered } from "./index";
import { listAgents } from "./registry";

/**
 * What the worker does on each tick: run every enabled agent that is on a schedule and is due, and close
 * proposals nobody decided in time. A failed run counts as a run, so a broken agent is not retried every tick.
 * One agent failing never stops the others.
 */
export async function runDueAgents(deps: FrameworkDeps & { ensure?: boolean } = {}): Promise<{ ran: string[]; expired: number }> {
  if (deps.ensure !== false) ensureAgentsRegistered();
  const now = deps.now ?? new Date();
  const ran: string[] = [];
  for (const agent of listAgents()) {
    if (!agent.schedule || agent.reactive) continue;
    const cfg = await getAgentConfig(agent.key, deps);
    if (!cfg.enabled) continue;
    const [last] = await withSystemContext(
      (tx) => tx.select({ at: max(agentRuns.startedAt) }).from(agentRuns).where(and(eq(agentRuns.agentKey, agent.key), eq(agentRuns.trigger, "schedule"))),
      { url: deps.systemUrl },
    );
    if (last?.at && now.getTime() - last.at.getTime() < agent.schedule.everyMs) continue;
    try {
      await runAgent(agent.key, { trigger: "schedule" }, deps);
    } catch (err) {
      console.error(`agent ${agent.key} could not run:`, err instanceof Error ? err.message : err);
    }
    ran.push(agent.key);
  }
  return { ran, expired: await expireProposals(deps) };
}
