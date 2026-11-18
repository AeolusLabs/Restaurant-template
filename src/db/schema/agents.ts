import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, minor, ts } from "./common";

/** One row per agent: whether it runs, how much it may do on its own, and what it may spend. Owners change it. */
export const agentConfigs = pgTable(
  "agent_configs",
  {
    id: id(),
    agentKey: text("agent_key").notNull().unique(),
    enabled: boolean("enabled").notNull().default(false),
    // suggest_only: advice only. approve_first: a person decides. auto: the executor runs at once.
    autonomy: text("autonomy").notNull().default("suggest_only"),
    // An owner's separate confirmation that customer-facing proposals may be sent without approval.
    autoConfirmedAt: ts("auto_confirmed_at"),
    autoConfirmedBy: uuid("auto_confirmed_by"),
    // Null means the restaurant-wide default from config (agents.defaultMonthlyCapMinor).
    monthlyCapMinor: minor("monthly_cap_minor"),
    settings: jsonb("settings").notNull().default({}),
    updatedBy: uuid("updated_by"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("agent_configs_autonomy_check", sql`${t.autonomy} in ('suggest_only', 'approve_first', 'auto')`),
    check("agent_configs_cap_check", sql`${t.monthlyCapMinor} is null or ${t.monthlyCapMinor} >= 0`),
  ],
);

/** Every time an agent ran, whatever happened: what it cost, and why it stopped if it did not finish. */
export const agentRuns = pgTable(
  "agent_runs",
  {
    id: id(),
    agentKey: text("agent_key").notNull(),
    trigger: text("trigger").notNull(),
    status: text("status").notNull().default("running"),
    startedAt: ts("started_at").notNull().defaultNow(),
    finishedAt: ts("finished_at"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costMinor: minor("cost_minor").notNull().default(0),
    model: text("model"),
    proposals: integer("proposals").notNull().default(0),
    error: text("error"),
    startedBy: uuid("started_by"),
  },
  (t) => [
    index("agent_runs_agent_idx").on(t.agentKey, t.startedAt),
    check("agent_runs_trigger_check", sql`${t.trigger} in ('schedule', 'manual', 'inbound')`),
    check("agent_runs_status_check", sql`${t.status} in ('running', 'succeeded', 'failed', 'refused_cap', 'skipped')`),
    check("agent_runs_nonneg_check", sql`${t.inputTokens} >= 0 and ${t.outputTokens} >= 0 and ${t.costMinor} >= 0`),
  ],
);

/**
 * What an agent wants done. The agent only writes these; the framework's executor does the thing, after the
 * decision the proposal's mode calls for. `mode` is the level it was made under and does not change afterwards.
 */
export const agentProposals = pgTable(
  "agent_proposals",
  {
    id: id(),
    runId: uuid("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "restrict" }),
    agentKey: text("agent_key").notNull(),
    kind: text("kind").notNull(),
    summary: text("summary").notNull(),
    payload: jsonb("payload").notNull(),
    customerFacing: boolean("customer_facing").notNull(),
    mode: text("mode").notNull(),
    status: text("status").notNull().default("pending"),
    // One live proposal per key: a customer is not proposed twice while the first is still open.
    dedupeKey: text("dedupe_key"),
    decidedBy: uuid("decided_by"),
    decidedAt: ts("decided_at"),
    executedAt: ts("executed_at"),
    result: jsonb("result"),
    error: text("error"),
    expiresAt: ts("expires_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("agent_proposals_status_idx").on(t.status, t.createdAt),
    index("agent_proposals_agent_idx").on(t.agentKey, t.createdAt),
    uniqueIndex("agent_proposals_open_dedupe").on(t.agentKey, t.dedupeKey).where(sql`${t.dedupeKey} is not null and ${t.status} in ('pending', 'approved')`),
    check("agent_proposals_mode_check", sql`${t.mode} in ('advice', 'approve', 'auto')`),
    check("agent_proposals_status_check", sql`${t.status} in ('pending', 'approved', 'rejected', 'executed', 'expired', 'failed')`),
  ],
);
