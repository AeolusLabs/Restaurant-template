import { parseMoneyInput } from "../lib/money";
import { normalizeCode } from "@/domain/promos/rules";
import { NUMERIC_AGENT_FIELDS } from "./settings-fields";
import { SUPPORT_KEY, supportSettings } from "./support";
import { WINBACK_KEY, winbackSettings } from "./winback";

// The agent settings form as an owner types it, and the checked values that are saved. Pure: text in, values or
// messages out. Each agent's own boxes are read here and then checked again by the agent's own schema.

export type AgentFormValue = {
  enabled: boolean;
  autonomy: "suggest_only" | "approve_first" | "auto";
  /** Null means the restaurant-wide default. */
  monthlyCapMinor: number | null;
  settings: Record<string, unknown>;
};
export type AgentFormResult = { ok: true; value: AgentFormValue } | { ok: false; errors: Record<string, string> };

const LEVELS = ["suggest_only", "approve_first", "auto"] as const;
const INT = /^\d{1,6}$/;

export function parseAgentForm(agentKey: string, raw: Record<string, string | undefined>, env: { exponent: number }): AgentFormResult {
  const errors: Record<string, string> = {};
  const text = (k: string) => (raw[k] ?? "").trim();

  const autonomy = LEVELS.find((l) => l === text("autonomy"));
  if (!autonomy) errors.autonomy = "Choose how much the agent may do on its own";

  let monthlyCapMinor: number | null = null;
  if (text("cap") !== "") {
    const cap = parseMoneyInput(text("cap"), env.exponent);
    if (cap === null) errors.cap = "Enter an amount like 500, or leave it empty to use the restaurant's default";
    else monthlyCapMinor = cap;
  }

  let settings: Record<string, unknown> = {};
  if (agentKey === WINBACK_KEY) {
    const num = (k: string, label: string) => {
      if (!INT.test(text(k))) {
        errors[k] = `${label} must be a whole number`;
        return undefined;
      }
      return Number(text(k));
    };
    let promoCode: string | null = null;
    if (text("promoCode") !== "") {
      promoCode = normalizeCode(text("promoCode"));
      if (!promoCode) errors.promoCode = "A code is 3 to 20 letters, digits, hyphens or underscores";
    }
    settings = { lapsedDays: num("lapsedDays", "Days quiet"), cooldownDays: num("cooldownDays", "Days between messages"), maxPerRun: num("maxPerRun", "Customers per run"), promoCode };
    const parsed = winbackSettings.safeParse(settings);
    if (!parsed.success) {
      const labels: Record<string, string> = { lapsedDays: "Days quiet must be between 7 and 365", cooldownDays: "Days between messages must be between 14 and 365", maxPerRun: "Customers per run must be between 1 and 100" };
      for (const issue of parsed.error.issues) {
        const k = String(issue.path[0]);
        if (!errors[k] && labels[k]) errors[k] = labels[k];
      }
    }
  } else if (agentKey === SUPPORT_KEY) {
    settings = { extraNotes: text("extraNotes") };
    if (!supportSettings.safeParse(settings).success) errors.extraNotes = "Keep the notes to 500 characters";
  } else if (NUMERIC_AGENT_FIELDS[agentKey]) {
    for (const f of NUMERIC_AGENT_FIELDS[agentKey]) {
      const n = INT.test(text(f.key)) ? Number(text(f.key)) : NaN;
      if (!(n >= f.min && n <= f.max)) errors[f.key] = `${f.label} must be a whole number from ${f.min} to ${f.max}`;
      else settings[f.key] = n;
    }
  } else {
    throw new Error(`No settings form for agent ${agentKey}`);
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, value: { enabled: text("enabled") === "on", autonomy: autonomy!, monthlyCapMinor, settings } };
}
