import { moneyInputValue, parseMoneyInput } from "../../lib/money";
import { localParts, zonedToUtc } from "../time";
import { normalizeCode, type PromoKind } from "./rules";

// The promo form as a manager types it, and the checked values the database stores. Pure: text in, values or
// messages out. Dates are wall-clock time in the restaurant's timezone, amounts are read exactly.

export type PromoFormValues = {
  code: string;
  description: string;
  kind: PromoKind;
  /** A percentage like "10" or "12.5", for kind percent. */
  percent: string;
  /** An amount like "500" or "1,250.50", for kind fixed. */
  amount: string;
  minOrder: string;
  maxDiscount: string;
  /** datetime-local: "2026-12-01T09:00". */
  startsAt: string;
  expiresAt: string;
  maxRedemptions: string;
  maxPerCustomer: string;
  /** A checkbox: "on" or "". */
  active: string;
};

export type PromoFields = {
  code: string;
  description: string;
  kind: PromoKind;
  value: number | null;
  minOrderMinor: number;
  maxDiscountMinor: number | null;
  startsAt: Date | null;
  expiresAt: Date | null;
  maxRedemptions: number | null;
  maxPerCustomer: number | null;
  active: boolean;
};

export type FormEnv = { exponent: number; timeZone: string };
export type PromoFormResult = { ok: true; fields: PromoFields } | { ok: false; errors: Record<string, string> };

const KINDS: readonly PromoKind[] = ["percent", "fixed", "free_delivery"];
const AMOUNT_HELP = "Enter an amount like 500 or 1,250.50";

function percentToBps(input: string): number | null {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0") || "0");
  return bps >= 1 && bps <= 10_000 ? bps : null;
}

/** "2026-12-01T09:00" as written on the restaurant's wall clock, to the instant it means. Null when it is not a real time. */
function parseLocal(input: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(input.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  const probe = new Date(Date.UTC(y, mo - 1, d, h, mi));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d || h > 23 || mi > 59) return null;
  return new Date(zonedToUtc(y, mo, d, h, mi, timeZone));
}

const wholeAboveZero = (input: string): number | null => (/^\d{1,9}$/.test(input.trim()) && Number(input) > 0 ? Number(input) : null);

export function parsePromoForm(v: PromoFormValues, env: FormEnv): PromoFormResult {
  const errors: Record<string, string> = {};
  const code = normalizeCode(v.code);
  if (!code) errors.code = "Use 3 to 20 letters, digits, hyphens or underscores";
  if (v.description.length > 200) errors.description = "Keep the description to 200 characters";
  if (!KINDS.includes(v.kind)) errors.kind = "Choose what the code does";

  let value: number | null = null;
  if (v.kind === "percent") {
    value = percentToBps(v.percent);
    if (value === null) errors.percent = "Enter a percentage between 0.01 and 100";
  } else if (v.kind === "fixed") {
    const n = parseMoneyInput(v.amount, env.exponent);
    if (n === null) errors.amount = AMOUNT_HELP;
    else if (n <= 0) errors.amount = "The amount must be more than zero";
    else value = n;
  }

  let minOrderMinor = 0;
  if (v.minOrder.trim() !== "") {
    const n = parseMoneyInput(v.minOrder, env.exponent);
    if (n === null) errors.minOrder = AMOUNT_HELP;
    else minOrderMinor = n;
  }

  let maxDiscountMinor: number | null = null;
  if (v.kind === "percent" && v.maxDiscount.trim() !== "") {
    const n = parseMoneyInput(v.maxDiscount, env.exponent);
    if (n === null || n <= 0) errors.maxDiscount = "Enter a cap like 2000, or leave it empty for no cap";
    else maxDiscountMinor = n;
  }

  const startsAt = v.startsAt.trim() === "" ? null : parseLocal(v.startsAt, env.timeZone);
  if (v.startsAt.trim() !== "" && !startsAt) errors.startsAt = "Choose a valid start date and time";
  const expiresAt = v.expiresAt.trim() === "" ? null : parseLocal(v.expiresAt, env.timeZone);
  if (v.expiresAt.trim() !== "" && !expiresAt) errors.expiresAt = "Choose a valid end date and time";
  if (startsAt && expiresAt && expiresAt <= startsAt) errors.expiresAt = "The end must be after the start";

  const limit = (raw: string, key: "maxRedemptions" | "maxPerCustomer", message: string): number | null => {
    if (raw.trim() === "") return null;
    const n = wholeAboveZero(raw);
    if (n === null) errors[key] = message;
    return n;
  };
  const maxRedemptions = limit(v.maxRedemptions, "maxRedemptions", "Enter a whole number above zero, or leave it empty for no limit");
  const maxPerCustomer = limit(v.maxPerCustomer, "maxPerCustomer", "Enter a whole number above zero, or leave it empty for no limit");

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    fields: { code: code!, description: v.description.trim(), kind: v.kind, value: v.kind === "free_delivery" ? null : value, minOrderMinor, maxDiscountMinor, startsAt, expiresAt, maxRedemptions, maxPerCustomer, active: v.active === "on" },
  };
}

const bpsToPercent = (bps: number) => {
  const whole = Math.floor(bps / 100);
  const frac = String(bps % 100).padStart(2, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
};

function toLocal(at: Date, timeZone: string): string {
  const p = localParts(at.getTime(), timeZone);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${p.y}-${two(p.m)}-${two(p.d)}T${two(p.h)}:${two(p.min)}`;
}

/** A saved promo as the form shows it, so editing round-trips exactly. */
export function promoToForm(p: PromoFields, env: FormEnv): PromoFormValues {
  return {
    code: p.code,
    description: p.description,
    kind: p.kind,
    percent: p.kind === "percent" && p.value !== null ? bpsToPercent(p.value) : "",
    amount: p.kind === "fixed" && p.value !== null ? moneyInputValue(p.value, env.exponent) : "",
    minOrder: p.minOrderMinor > 0 ? moneyInputValue(p.minOrderMinor, env.exponent) : "",
    maxDiscount: p.maxDiscountMinor !== null ? moneyInputValue(p.maxDiscountMinor, env.exponent) : "",
    startsAt: p.startsAt ? toLocal(p.startsAt, env.timeZone) : "",
    expiresAt: p.expiresAt ? toLocal(p.expiresAt, env.timeZone) : "",
    maxRedemptions: p.maxRedemptions !== null ? String(p.maxRedemptions) : "",
    maxPerCustomer: p.maxPerCustomer !== null ? String(p.maxPerCustomer) : "",
    active: p.active ? "on" : "",
  };
}
