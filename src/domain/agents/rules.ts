import { localParts, zonedToUtc } from "../time";

// Rules for the agent framework. Pure: no database, no HTTP, no model. See
// docs/superpowers/plans/2026-11-18-phase-8-agents.md.

export type Usage = { inputTokens: number; outputTokens: number };
/** Kobo per million tokens, from config (agents.modelPrices). */
export type ModelPrice = { inputPerMTokMinor: number; outputPerMTokMinor: number };

const whole = (n: number, what: string) => {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`${what} must be a whole number of at least zero, got ${n}`);
  return BigInt(n);
};

/** What a call cost, in whole kobo. Rounded up, so spend is never under-counted. Exact: no floating point. */
export function costMinor(usage: Usage, price: ModelPrice): number {
  const total = whole(usage.inputTokens, "inputTokens") * whole(price.inputPerMTokMinor, "input price") + whole(usage.outputTokens, "outputTokens") * whole(price.outputPerMTokMinor, "output price");
  return Number((total + 999_999n) / 1_000_000n);
}

/** About four characters to a token: close enough to reserve budget before a call. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

/** The most a call could cost: its input as estimated, and the whole output allowance used. */
export function callEstimateMinor(req: { system: string; messages: { role: string; content: string }[]; maxOutputTokens: number }, price: ModelPrice): number {
  const input = estimateTokens(req.system) + req.messages.reduce((n, m) => n + estimateTokens(m.content), 0);
  return costMinor({ inputTokens: input, outputTokens: req.maxOutputTokens }, price);
}

/** Whether spending `estimate` more keeps this month's total within the cap. A call that costs nothing is never refused. */
export const withinCap = (spent: number, estimate: number, cap: number): boolean => estimate <= 0 || spent + estimate <= cap;

/** The restaurant's calendar month containing `now`: from local midnight on the 1st to local midnight on the next 1st. */
export function monthWindow(now: Date, timeZone: string): { start: Date; end: Date } {
  const p = localParts(now.getTime(), timeZone);
  const nextY = p.m === 12 ? p.y + 1 : p.y;
  const nextM = p.m === 12 ? 1 : p.m + 1;
  return { start: new Date(zonedToUtc(p.y, p.m, 1, 0, 0, timeZone)), end: new Date(zonedToUtc(nextY, nextM, 1, 0, 0, timeZone)) };
}

export type Autonomy = "suggest_only" | "approve_first" | "auto";
export type Mode = "advice" | "approve" | "auto";

/**
 * What happens to a proposal. Advice can only be dismissed; approve waits for a person; auto runs at once.
 * Anything a customer will read runs automatically only when an owner has separately confirmed it.
 */
export function effectiveMode(autonomy: Autonomy, customerFacing: boolean, autoConfirmed: boolean): Mode {
  if (autonomy === "suggest_only") return "advice";
  if (autonomy === "approve_first") return "approve";
  return customerFacing && !autoConfirmed ? "approve" : "auto";
}

const NEUTRAL: Record<string, string> = { name: "there", dish: "something from the menu", code: "" };

/** Puts values into {name}, {dish} and {code}. One pass, so a value that contains braces is not expanded again. */
export function fillTemplate(template: string, vars: Partial<Record<"name" | "dish" | "code", string>>): string {
  return template.replace(/\{(name|dish|code)\}/g, (_, key: string) => (vars as Record<string, string | undefined>)[key] || NEUTRAL[key]);
}

const LINKISH = /(https?:|www\.|:\/\/)|\b[\w-]+\.(com|ng|net|org|co|io|app|link|me|ly|example|xyz|info)\b/i;

/** Checks a message template written by a model: sensible length, only known placeholders, and no links. */
export function validateTemplate(text: string, allowed: readonly string[]): { ok: true } | { ok: false; reason: string } {
  if (text.length < 20) return { ok: false, reason: "too short" };
  if (text.length > 320) return { ok: false, reason: "too long" };
  for (const m of text.matchAll(/\{([^}]*)\}/g)) if (!allowed.includes(m[1])) return { ok: false, reason: `unknown placeholder {${m[1]}}` };
  if (LINKISH.test(text)) return { ok: false, reason: "contains a link" };
  return { ok: true };
}

/** The message used when no model is available: plain, warm, and valid under validateTemplate. */
export const fallbackTemplate = (withCode: boolean): string =>
  `Hi {name}, we have missed you! Come back and treat yourself to {dish}.${withCode ? " Use code {code} on your next order." : ""}`;
