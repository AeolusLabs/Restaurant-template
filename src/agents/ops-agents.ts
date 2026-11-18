import { sql } from "drizzle-orm";
import type { z } from "zod";
import { planDemand, stuckReason } from "@/domain/agents/ops";
import { localDay } from "@/domain/time";
import { ALERT_KIND, ARCHIVE_KIND, BLOCK_KIND, NOTE_KIND, type AlertPayload, type ArchivePayload, type BlockPayload, type NotePayload } from "./ops-executors";
import { ANOMALY_KEY, DEMAND_KEY, MENU_KEY, NUMERIC_AGENT_FIELDS, WATCHDOG_KEY, numericDefaults, numericSchema } from "./settings-fields";
import type { Agent, AgentContext, ProposalDraft } from "./types";

// The four operations agents. Rule-based, so they cost nothing to run and behave the same every time. They only
// propose: an executor in ops-executors.ts does the thing, after the decision the agent's level calls for.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WEEKDAY_NAMES: Record<string, string> = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" };
const two = (n: number) => String(n).padStart(2, "0");
const hh = (h: number) => `${two(h)}:00`;

type S<K extends string> = z.infer<ReturnType<typeof numericSchema>> & Record<string, number> & { __k?: K };
const make = <K extends string>(key: K, title: string, description: string, schedule: number, run: (ctx: AgentContext<S<K>, unknown>) => Promise<ProposalDraft[]>): Agent<S<K>, unknown> => {
  const fields = NUMERIC_AGENT_FIELDS[key];
  return { key, title, description, settingsSchema: numericSchema(fields) as never, defaultSettings: numericDefaults(fields) as never, schedule: { everyMs: schedule }, run };
};

/** Whether this key was proposed by this agent since `since`, whatever became of it. Stops an alert coming back every run. */
const proposedSince = (ctx: AgentContext<unknown, unknown>, key: string, dedupe: string, since: Date) =>
  ctx.read(async (tx) => (await tx.execute(sql`select 1 from agent_proposals where agent_key = ${key} and dedupe_key = ${dedupe} and created_at > ${since.toISOString()}::timestamptz limit 1`)).rows.length > 0);

/** Tomorrow's expectation, from the same weekday in recent weeks. */
export const demandAgent = make(DEMAND_KEY, "Plan tomorrow's prep", "Each day, a note on how many orders to expect tomorrow, the busiest hour, and which dishes to prepare, from the same weekday in recent weeks.", DAY, async (ctx) => {
  const tz = ctx.config.timezone;
  const tomorrow = localDay(ctx.now.getTime(), tz, 1);
  if (ctx.config.openingHours[tomorrow.weekday].length === 0) return [];
  const key = `${tomorrow.y}-${two(tomorrow.m)}-${two(tomorrow.d)}`;
  if (await proposedSince(ctx as never, ctx.agentKey, `demand:${key}`, new Date(ctx.now.getTime() - DAY))) return [];
  const dates = Array.from({ length: ctx.settings.historyWeeks }, (_, i) => localDay(ctx.now.getTime(), tz, 1 - 7 * (i + 1))).map((d) => `${d.y}-${two(d.m)}-${two(d.d)}`);

  const wanted = sql.join(dates.map((d) => sql`${d}`), sql`, `);
  const { cells, items } = await ctx.read(async (tx) => {
    const day = sql`to_char(pay.paid_at at time zone ${tz}, 'YYYY-MM-DD')`;
    const cellRows = (await tx.execute(sql`
      select ${day} as d, extract(hour from pay.paid_at at time zone ${tz})::int as h, count(*)::int as n
      from payments pay where pay.status = 'succeeded' and ${day} in (${wanted}) group by 1, 2`)).rows;
    const itemRows = (await tx.execute(sql`
      select oi.name_snapshot as name, sum(oi.quantity)::int as qty
      from payments pay join order_items oi on oi.order_id = pay.order_id
      where pay.status = 'succeeded' and ${day} in (${wanted}) group by 1`)).rows;
    return { cells: cellRows.map((r) => ({ date: r.d as string, hour: Number(r.h), orders: Number(r.n) })), items: itemRows.map((r) => ({ name: r.name as string, quantity: Number(r.qty) })) };
  });
  const plan = planDemand({ cells, items, dayCount: new Set(cells.map((c) => c.date)).size });
  if (!plan) return [];
  const weekday = WEEKDAY_NAMES[tomorrow.weekday];
  const prep = plan.topItems.map((i) => `${i.name} (about ${i.perDay})`).join(", ");
  const title = `Tomorrow, ${weekday}: about ${plan.expectedOrders} orders`;
  const detail = `${weekday}s have averaged about ${plan.expectedOrders} paid orders${plan.busiestHour !== null ? `, busiest around ${hh(plan.busiestHour)}` : ""}.${prep ? ` Most ordered: ${prep}.` : ""}`;
  return [{ kind: NOTE_KIND, summary: `${title}. ${detail}`, payload: { title, detail } satisfies NotePayload, customerFacing: false, dedupeKey: `demand:${key}` }];
});

/** Dishes that have not sold in a long time. Hiding is reversible. */
export const menuAgent = make(MENU_KEY, "Tidy the menu", "Every week, suggests hiding dishes that have not sold for a long time, but never when the restaurant is quiet overall.", 7 * DAY, async (ctx) => {
  const since = new Date(ctx.now.getTime() - ctx.settings.quietDays * DAY);
  const rows = await ctx.read(async (tx) => {
    const busy = (await tx.execute(sql`select count(*)::int as n from payments where status = 'succeeded' and paid_at >= ${since.toISOString()}::timestamptz and paid_at < ${ctx.now.toISOString()}::timestamptz`)).rows[0];
    if (Number(busy?.n ?? 0) < 20) return [];
    return (
      await tx.execute(sql`
        select mi.id, mi.name from menu_items mi
        where mi.active and mi.available and mi.created_at < ${since.toISOString()}::timestamptz
          and not exists (select 1 from order_items oi join payments pay on pay.order_id = oi.order_id and pay.status = 'succeeded' and pay.paid_at >= ${since.toISOString()}::timestamptz and pay.paid_at < ${ctx.now.toISOString()}::timestamptz where oi.item_id = mi.id)
          and not exists (select 1 from agent_proposals ap where ap.agent_key = ${ctx.agentKey} and ap.dedupe_key = 'menu-archive:' || mi.id::text and ap.created_at > ${new Date(ctx.now.getTime() - 90 * DAY).toISOString()}::timestamptz)
        order by mi.created_at, mi.name limit ${ctx.settings.maxPerRun}`)
    ).rows;
  });
  return rows.map((r) => {
    const reason = `It has not sold in ${ctx.settings.quietDays} days`;
    return { kind: ARCHIVE_KIND, summary: `Hide "${r.name}" from the menu: ${reason.toLowerCase()}.`, payload: { itemId: r.id as string, name: r.name as string, reason } satisfies ArchivePayload, customerFacing: false, dedupeKey: `menu-archive:${r.id}` };
  });
});

/** Deliveries that are taking too long. */
export const watchdogAgent = make(WATCHDOG_KEY, "Watch deliveries", "Flags a delivery that has no rider, has not been collected, or has been on the road too long, before the customer rings to ask.", 10 * 60_000, async (ctx) => {
  const rows = await ctx.read(
    async (tx) =>
      (
        await tx.execute(sql`
          select d.id, d.status, d.attempts, o.public_code, extract(epoch from (${ctx.now.toISOString()}::timestamptz - d.updated_at)) / 60 as minutes
          from deliveries d join orders o on o.id = d.order_id
          where o.status in ('accepted', 'preparing', 'ready', 'out_for_delivery') and d.status in ('queued', 'pending', 'awaiting_pickup', 'in_transit')`)
      ).rows,
  );
  const out: ProposalDraft[] = [];
  for (const r of rows) {
    const reason = stuckReason({ status: r.status as string, attempts: Number(r.attempts), minutes: Number(r.minutes) }, ctx.settings as never);
    if (!reason) continue;
    const dedupe = `stuck:${r.id}:${r.status}`;
    if (await proposedSince(ctx as never, ctx.agentKey, dedupe, new Date(ctx.now.getTime() - 6 * HOUR))) continue;
    out.push({ kind: ALERT_KIND, summary: `Order ${r.public_code}: ${reason}.`, payload: { kind: "delivery_stuck", orderCode: r.public_code as string, detail: reason } satisfies AlertPayload, customerFacing: false, dedupeKey: dedupe });
  }
  return out;
});

/** Customers with a pattern that looks like abuse. Blocking is for a person to decide. */
export const anomalyAgent = make(ANOMALY_KEY, "Watch for abuse", "Suggests reviewing a customer with repeated refunds, or who keeps letting orders expire unpaid, and gives the evidence.", 6 * HOUR, async (ctx) => {
  const month = new Date(ctx.now.getTime() - 30 * DAY).toISOString();
  const day = new Date(ctx.now.getTime() - DAY).toISOString();
  const cooling = new Date(ctx.now.getTime() - 7 * DAY).toISOString();
  const found = await ctx.read(async (tx) => {
    const eligible = sql`p.role = 'customer' and p.blocked_at is null and p.deleted_at is null`;
    const refunds = (
      await tx.execute(sql`
        select p.id, p.full_name, count(*)::int as n from payments pay join orders o on o.id = pay.order_id join profiles p on p.id = o.profile_id
        where ${eligible} and pay.status = 'refunded' and pay.paid_at >= ${month}::timestamptz and pay.paid_at < ${ctx.now.toISOString()}::timestamptz
          and not exists (select 1 from agent_proposals ap where ap.agent_key = ${ctx.agentKey} and ap.dedupe_key = 'anomaly:' || p.id::text || ':refunds' and ap.created_at > ${cooling}::timestamptz)
        group by p.id, p.full_name having count(*) >= ${ctx.settings.refundLimit}`)
    ).rows.map((r) => ({ id: r.id as string, name: r.full_name as string, rule: "refunds", reason: `${r.n} of their orders were refunded in the last 30 days` }));
    const unpaid = (
      await tx.execute(sql`
        select p.id, p.full_name, count(*)::int as n from order_events e join orders o on o.id = e.order_id join profiles p on p.id = o.profile_id
        where ${eligible} and e.from_status = 'placed' and e.to_status = 'cancelled' and e.created_at >= ${day}::timestamptz and e.created_at < ${ctx.now.toISOString()}::timestamptz
          and not exists (select 1 from agent_proposals ap where ap.agent_key = ${ctx.agentKey} and ap.dedupe_key = 'anomaly:' || p.id::text || ':unpaid' and ap.created_at > ${cooling}::timestamptz)
        group by p.id, p.full_name having count(*) >= ${ctx.settings.unpaidLimit}`)
    ).rows.map((r) => ({ id: r.id as string, name: r.full_name as string, rule: "unpaid", reason: `${r.n} of their orders expired or were abandoned unpaid in the last 24 hours` }));
    return [...refunds, ...unpaid];
  });
  return found.map((f) => ({
    kind: BLOCK_KIND,
    summary: `Review ${f.name}: ${f.reason}. Blocking stops them signing in or ordering.`,
    payload: { profileId: f.id, name: f.name, reason: f.reason } satisfies BlockPayload,
    customerFacing: true,
    dedupeKey: `anomaly:${f.id}:${f.rule}`,
  }));
});
