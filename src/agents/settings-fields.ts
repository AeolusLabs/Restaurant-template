import { z } from "zod";

// The settings of the operations agents are all whole numbers with a range, so one table describes them: the agent's
// schema, the settings form and the screen are all made from it. See docs/superpowers/plans/2026-11-18-phase-9-demo-and-agents.md.

export type NumField = { key: string; label: string; help: string; min: number; max: number; default: number };

export const DEMAND_KEY = "demand-planner";
export const MENU_KEY = "menu-engineer";
export const WATCHDOG_KEY = "delivery-watchdog";
export const ANOMALY_KEY = "anomaly-detector";

export const NUMERIC_AGENT_FIELDS: Record<string, NumField[]> = {
  [DEMAND_KEY]: [{ key: "historyWeeks", label: "Weeks of history", help: "How many earlier weeks of the same weekday to learn from (2 to 12).", min: 2, max: 12, default: 4 }],
  [MENU_KEY]: [
    { key: "quietDays", label: "Days without a sale", help: "A dish that has not sold for this many days is suggested for hiding (14 to 365).", min: 14, max: 365, default: 60 },
    { key: "maxPerRun", label: "Suggestions per run", help: "At most this many dishes at a time (1 to 20).", min: 1, max: 20, default: 5 },
  ],
  [WATCHDOG_KEY]: [
    { key: "queuedMinutes", label: "Minutes a failing booking may wait", help: "A booking that has failed and is still waiting after this long is flagged (5 to 240).", min: 5, max: 240, default: 20 },
    { key: "awaitingMinutes", label: "Minutes to find or collect with a rider", help: "No rider assigned, or not yet collected, after this long (15 to 480).", min: 15, max: 480, default: 60 },
    { key: "transitMinutes", label: "Minutes on the road", help: "A delivery on the road for longer than this is flagged (30 to 720).", min: 30, max: 720, default: 120 },
  ],
  [ANOMALY_KEY]: [
    { key: "refundLimit", label: "Refunds in 30 days", help: "A customer with this many refunds in 30 days is suggested for review (2 to 20).", min: 2, max: 20, default: 3 },
    { key: "unpaidLimit", label: "Unpaid orders in a day", help: "A customer who lets this many orders expire unpaid in 24 hours is suggested for review (3 to 50).", min: 3, max: 50, default: 5 },
  ],
};

export const numericSchema = (fields: NumField[]) => z.object(Object.fromEntries(fields.map((f) => [f.key, z.number().int().min(f.min).max(f.max).default(f.default)])));
export const numericDefaults = (fields: NumField[]): Record<string, number> => Object.fromEntries(fields.map((f) => [f.key, f.default]));
