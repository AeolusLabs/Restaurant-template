import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { RestaurantConfig } from "../../config/schema";
import { withSystemContext } from "@/db/context";
import { agentRuns } from "@/db/schema";
import { callEstimateMinor, costMinor, monthWindow, withinCap } from "@/domain/agents/rules";
import type { LLMProvider, LLMRequest } from "@/providers/llm/types";

/** The call would take this agent past its monthly cap. Nothing was sent to the model. */
export class CapExceededError extends Error {}
/** The model has no price in config, so what a call costs cannot be known and it is not allowed. */
export class ModelNotPricedError extends Error {}

type Deps = { provider: LLMProvider; config: RestaurantConfig; now: Date; systemUrl?: string };

/**
 * The only way an agent reaches a model. Before a call it reserves its worst-case cost against this agent's
 * month (under a lock, so two runs cannot both spend the last of the budget), and after the call it replaces
 * the reservation with what the call actually cost. A call that fails gives the reservation back.
 */
export function budgetedLLM(runId: string, agentKey: string, capMinor: number, deps: Deps): Pick<LLMProvider, "complete"> {
  const url = { url: deps.systemUrl };
  return {
    async complete<T>(request: LLMRequest<T>) {
      const price = deps.config.agents.modelPrices[deps.provider.model];
      if (!price) throw new ModelNotPricedError(`The model ${deps.provider.model} has no price in config (agents.modelPrices), so it cannot be used`);
      const estimate = callEstimateMinor(request, price);
      const month = monthWindow(deps.now, deps.config.timezone);

      await withSystemContext(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`agent-spend:${agentKey}`}, 0))`);
        const [row] = await tx
          .select({ total: sql<number>`coalesce(sum(${agentRuns.costMinor}), 0)`.mapWith(Number) })
          .from(agentRuns)
          .where(and(eq(agentRuns.agentKey, agentKey), gte(agentRuns.startedAt, month.start), lt(agentRuns.startedAt, month.end)));
        if (!withinCap(row?.total ?? 0, estimate, capMinor)) {
          throw new CapExceededError(`This call could cost up to ${estimate} and would pass the monthly cap of ${capMinor} (already used ${row?.total ?? 0})`);
        }
        await tx.update(agentRuns).set({ costMinor: sql`${agentRuns.costMinor} + ${estimate}`, model: deps.provider.model }).where(eq(agentRuns.id, runId));
      }, url);

      let result;
      try {
        result = await deps.provider.complete(request);
      } catch (err) {
        await withSystemContext((tx) => tx.update(agentRuns).set({ costMinor: sql`${agentRuns.costMinor} - ${estimate}` }).where(eq(agentRuns.id, runId)), url);
        throw err;
      }
      const actual = costMinor(result.usage, price);
      await withSystemContext(
        (tx) =>
          tx
            .update(agentRuns)
            .set({
              costMinor: sql`${agentRuns.costMinor} - ${estimate} + ${actual}`,
              inputTokens: sql`${agentRuns.inputTokens} + ${result.usage.inputTokens}`,
              outputTokens: sql`${agentRuns.outputTokens} + ${result.usage.outputTokens}`,
            })
            .where(eq(agentRuns.id, runId)),
        url,
      );
      return result;
    },
  };
}
