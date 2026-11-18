import { sql } from "drizzle-orm";
import { z } from "zod";
import { fallbackTemplate, fillTemplate, validateTemplate } from "@/domain/agents/rules";
import { normalizeCode } from "@/domain/promos/rules";
import type { Agent, Executor } from "./types";

// Win-back: proposes a friendly message to customers who agreed to hear from the restaurant and have gone quiet.
// It never sends: it returns proposals, and winbackExecutor sends one only after the decision its mode calls for.
// The wording comes from a model when the monthly cap allows, and from a fixed template when it does not, so the
// agent works at no AI cost at all.

export const WINBACK_KEY = "winback";
export const WINBACK_KIND = "winback.message";

export const winbackSettings = z.object({
  /** A customer is quiet when their last paid order is at least this many days old. */
  lapsedDays: z.number().int().min(7).max(365).default(45),
  /** The same customer is not proposed again for this many days. */
  cooldownDays: z.number().int().min(14).max(365).default(90),
  maxPerRun: z.number().int().min(1).max(100).default(20),
  /** An existing promo code to mention, chosen by a manager. The agent never creates promos. */
  promoCode: z.string().trim().max(20).nullable().default(null),
});
export type WinbackSettings = z.infer<typeof winbackSettings>;

export const winbackPayload = z.object({
  profileId: z.uuid(),
  phone: z.string().min(7).max(20),
  name: z.string().min(1).max(60),
  text: z.string().min(10).max(500),
  wording: z.enum(["model", "template"]),
});
export type WinbackPayload = z.infer<typeof winbackPayload>;

const DAY = 86_400_000;
const firstName = (full: string) => (full.trim().split(/\s+/)[0] ?? "").replace(/[^\p{L}\p{N}'-]/gu, "").slice(0, 30) || "there";

type Candidate = { id: string; name: string; phone: string; lastPaid: Date; dish: string | null };

export const winbackAgent: Agent<WinbackSettings, unknown> = {
  key: WINBACK_KEY,
  title: "Win back quiet customers",
  description: "Suggests a friendly WhatsApp message to customers who agreed to marketing and have not ordered for a while.",
  settingsSchema: winbackSettings,
  defaultSettings: winbackSettings.parse({}),
  schedule: { everyMs: DAY },

  async run(ctx) {
    const s = ctx.settings;
    const lapsedBefore = new Date(ctx.now.getTime() - s.lapsedDays * DAY);
    const coolingSince = new Date(ctx.now.getTime() - s.cooldownDays * DAY);

    // A code the manager chose must be live now, or the run fails loudly: a quiet message without the offer
    // they intended would be worse than no message.
    let code: string | null = null;
    if (s.promoCode) {
      code = normalizeCode(s.promoCode);
      const live = code
        ? await ctx.read(async (tx) => (await tx.execute(sql`select 1 from promos where code = ${code} and active and (expires_at is null or expires_at > ${ctx.now.toISOString()}::timestamptz) and (starts_at is null or starts_at <= ${ctx.now.toISOString()}::timestamptz)`)).rows.length > 0)
        : false;
      if (!live) throw new Error(`The promo code ${s.promoCode} is not active, so the message cannot mention it. Switch it on, or clear it in this agent's settings.`);
    }

    const candidates = await ctx.read(async (tx): Promise<Candidate[]> => {
      const { rows } = await tx.execute(sql`
        select p.id, p.full_name,
          coalesce(nullif(p.phone, ''), (select oc.phone from order_contacts oc join orders o on o.id = oc.order_id where o.profile_id = p.id order by o.placed_at desc limit 1)) as phone,
          l.last_paid,
          (select oi.name_snapshot from order_items oi join orders o on o.id = oi.order_id where o.profile_id = p.id group by oi.name_snapshot order by sum(oi.quantity) desc, oi.name_snapshot limit 1) as dish
        from profiles p
        cross join lateral (
          select max(pay.paid_at) as last_paid
          from payments pay join orders o on o.id = pay.order_id
          where o.profile_id = p.id and pay.status in ('succeeded', 'refunded', 'partially_refunded')
        ) l
        where p.role = 'customer' and p.blocked_at is null and p.deleted_at is null
          and l.last_paid is not null and l.last_paid < ${lapsedBefore.toISOString()}::timestamptz
          and (select c.withdrawn_at is null from consents c where c.profile_id = p.id and c.type = 'marketing' order by c.granted_at desc limit 1) is true
          and not exists (select 1 from agent_proposals ap where ap.agent_key = ${ctx.agentKey} and ap.dedupe_key = 'winback:' || p.id::text and ap.created_at > ${coolingSince.toISOString()}::timestamptz)
        order by l.last_paid desc
        limit ${s.maxPerRun * 3}`);
      return rows
        .filter((r) => typeof r.phone === "string" && r.phone.replace(/\D/g, "").length >= 7)
        .slice(0, s.maxPerRun)
        .map((r) => ({ id: r.id as string, name: r.full_name as string, phone: r.phone as string, lastPaid: new Date(r.last_paid as string), dish: (r.dish as string | null) ?? null }));
    });
    if (candidates.length === 0) return [];

    // One request for the wording of the whole batch, with {name} and {dish} left to be filled in per customer.
    const allowed = code ? ["name", "dish", "code"] : ["name", "dish"];
    let template = fallbackTemplate(!!code);
    let wording: WinbackPayload["wording"] = "template";
    try {
      const { output } = await ctx.llm.complete({
        system:
          "You write one short, warm WhatsApp message for a restaurant to send to a past customer who has not ordered for a while. " +
          "Use the placeholders {name} for their first name and {dish} for a dish they like. " +
          (code ? "Mention the offer using the placeholder {code}. " : "Do not mention any offer or discount. ") +
          "Under 280 characters. Plain text. No links, no emojis, no phone numbers.",
        messages: [{ role: "user", content: `Restaurant: ${ctx.config.name}` }],
        schema: z.object({ message: z.string() }),
        maxOutputTokens: 200,
      });
      let drafted = output.message.trim();
      if (code && !drafted.includes("{code}")) drafted += " Use code {code} on your next order.";
      if (validateTemplate(drafted, allowed).ok) {
        template = drafted;
        wording = "model";
      }
    } catch {
      // No model (cap reached, no price, an outage): the fixed wording is used and the proposal says so.
    }

    return candidates.map((c) => {
      const name = firstName(c.name);
      const text = fillTemplate(template, { name, dish: c.dish ?? undefined, code: code ?? undefined });
      const days = Math.max(1, Math.floor((ctx.now.getTime() - c.lastPaid.getTime()) / DAY));
      const payload: WinbackPayload = { profileId: c.id, phone: c.phone, name, text, wording };
      return {
        kind: WINBACK_KIND,
        summary: `WhatsApp ${name}, who last ordered ${days} days ago${c.dish ? ` (likes ${c.dish})` : ""}: "${text}"${wording === "template" ? " [standard wording]" : ""}`,
        payload,
        customerFacing: true,
        dedupeKey: `winback:${c.id}`,
      };
    });
  },
};

/** Sends the message, after checking again that the customer still agrees to hear from the restaurant. */
export const winbackExecutor: Executor<WinbackPayload> = {
  kind: WINBACK_KIND,
  payloadSchema: winbackPayload,
  async execute(p, deps, tx) {
    const { rows } = await tx.execute(sql`
      select p.blocked_at, p.deleted_at,
        (select c.withdrawn_at is null from consents c where c.profile_id = p.id and c.type = 'marketing' order by c.granted_at desc limit 1) as consent
      from profiles p where p.id = ${p.profileId}::uuid`);
    const r = rows[0];
    if (!r || r.deleted_at) throw new Error("Not sent: the customer's account no longer exists");
    if (r.blocked_at) throw new Error("Not sent: the customer is blocked");
    if (r.consent !== true) throw new Error("Not sent: the customer no longer agrees to marketing messages");
    await deps.notifications.send({ channel: "whatsapp", to: p.phone, template: "winback", vars: { name: p.name, text: p.text } });
    return { sentTo: `${p.phone.slice(0, 4)}***${p.phone.slice(-2)}` };
  },
};
