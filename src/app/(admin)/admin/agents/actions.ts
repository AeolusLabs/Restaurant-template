"use server";

import { restaurantConfig } from "../../../../../config/restaurant";
import { AgentConfigError, saveAgentConfig, setAutoConfirmation } from "@/agents/admin";
import { ProposalNotDecidableError, decideProposal, runAgent } from "@/agents/framework";
import { ensureAgentsRegistered } from "@/agents/index";
import { UnknownAgentError, listAgents } from "@/agents/registry";
import { NUMERIC_AGENT_FIELDS } from "@/agents/settings-fields";
import { parseAgentForm } from "@/agents/settings-form";
import { requireStaff } from "@/auth/customer";
import { ForbiddenError } from "@/auth/session";
import { text } from "@/lib/form";
import { redirectWith } from "@/lib/notice";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIST = "/admin/agents";
const QUEUE = "/admin/agents/proposals";

const NUMERIC = Object.values(NUMERIC_AGENT_FIELDS).flat();
const FIELDS = [...new Set(["enabled", "autonomy", "cap", "lapsedDays", "cooldownDays", "maxPerRun", "promoCode", "extraNotes", ...NUMERIC.map((f) => f.key)])];
const LABEL: Record<string, string> = {
  ...Object.fromEntries(NUMERIC.map((f) => [f.key, f.label])),
  autonomy: "How much it may do",
  cap: "Monthly spending limit",
  lapsedDays: "Days quiet",
  cooldownDays: "Days between messages",
  maxPerRun: "Customers per run",
  promoCode: "Promo code",
  extraNotes: "Notes for the assistant",
};

function knownKey(form: FormData): string {
  ensureAgentsRegistered();
  const key = text(form, "key");
  if (!listAgents().some((a) => a.key === key)) redirectWith(LIST, { error: "That agent could not be found." });
  return key;
}

function describe(err: unknown): string {
  if (err instanceof AgentConfigError || err instanceof ForbiddenError || err instanceof UnknownAgentError || err instanceof ProposalNotDecidableError) return err.message;
  throw err;
}

/** An owner saves an agent's settings. */
export async function saveAgentAction(form: FormData): Promise<void> {
  const key = knownKey(form);
  const here = `${LIST}/${key}`;
  const { ctx } = await requireStaff(["owner"], here);
  const raw = Object.fromEntries(FIELDS.map((f) => [f, text(form, f)]));
  const parsed = parseAgentForm(key, raw, { exponent: restaurantConfig.currency.exponent });
  if (!parsed.ok) {
    const error = Object.entries(parsed.errors).map(([k, m]) => `${LABEL[k] ?? k}: ${m}`).join(". ");
    redirectWith(here, { error, values: raw });
  }
  try {
    await saveAgentConfig(ctx, key, parsed.value!);
  } catch (err) {
    redirectWith(here, { error: describe(err), values: raw });
  }
  redirectWith(here, { notice: "Saved." });
}

/** An owner confirms (typing SEND), or takes back, that an agent may send to customers without approval. */
export async function confirmAutoSendAction(form: FormData): Promise<void> {
  const key = knownKey(form);
  const here = `${LIST}/${key}`;
  const { ctx } = await requireStaff(["owner"], here);
  const confirm = text(form, "confirm") === "true";
  try {
    await setAutoConfirmation(ctx, key, confirm, text(form, "typed"));
  } catch (err) {
    redirectWith(here, { error: describe(err) });
  }
  redirectWith(here, { notice: confirm ? "Confirmed. This agent may now send to customers without waiting for approval." : "Taken back. Messages to customers will wait for approval again." });
}

/** An owner runs a scheduled agent now. It only proposes: nothing is sent by running it. */
export async function runAgentNowAction(form: FormData): Promise<void> {
  const key = knownKey(form);
  const here = `${LIST}/${key}`;
  const { ctx } = await requireStaff(["owner"], here);
  const r = await runAgent(key, { trigger: "manual", startedBy: ctx.userId });
  if (r.status === "succeeded") redirectWith(here, { notice: r.proposalIds.length === 0 ? "Ran. There was nothing to propose." : `Ran. ${r.proposalIds.length} ${r.proposalIds.length === 1 ? "suggestion is" : "suggestions are"} waiting in the queue.` });
  redirectWith(here, { error: r.status === "skipped" ? "The agent is switched off." : (r.error ?? "The run did not finish.") });
}

/** A manager or owner approves or rejects a proposal. Approving carries it out. */
export async function decideProposalAction(form: FormData): Promise<void> {
  const id = text(form, "id");
  if (!UUID.test(id)) redirectWith(QUEUE, { error: "That suggestion could not be found." });
  const { ctx } = await requireStaff(["owner", "manager"], QUEUE);
  ensureAgentsRegistered();
  const approve = text(form, "decision") === "approve";
  let outcome: string;
  try {
    outcome = await decideProposal(ctx, id, approve);
  } catch (err) {
    redirectWith(QUEUE, { error: describe(err) });
  }
  redirectWith(QUEUE, outcome === "rejected" ? { notice: "Dismissed." } : outcome === "executed" ? { notice: "Done." } : { error: "It was approved, but it could not be carried out. The reason is shown under Recently dealt with." });
}
