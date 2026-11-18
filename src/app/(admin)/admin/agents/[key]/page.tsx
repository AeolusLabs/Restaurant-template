import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { restaurantConfig as c } from "../../../../../../config/restaurant";
import { agentOverview, listRuns } from "@/agents/admin";
import { ensureAgentsRegistered } from "@/agents/index";
import { NUMERIC_AGENT_FIELDS } from "@/agents/settings-fields";
import { WINBACK_KEY } from "@/agents/winback";
import { SUPPORT_KEY } from "@/agents/support";
import { requireStaff } from "@/auth/customer";
import { Notice } from "@/components/staff/notice";
import { button, card, field, label } from "@/components/ui";
import { dateTime, money } from "@/lib/format";
import { moneyInputValue } from "@/lib/money";
import { valuesFrom } from "@/lib/notice-url";
import { confirmAutoSendAction, runAgentNowAction, saveAgentAction } from "../actions";
import { LEVEL } from "../levels";

export const metadata: Metadata = { title: "Agent" };
const hint = "mt-1 text-sm text-muted";

async function Settings({ params, searchParams }: { params: PageProps<"/admin/agents/[key]">["params"]; searchParams: PageProps<"/admin/agents/[key]">["searchParams"] }) {
  await connection();
  ensureAgentsRegistered();
  const { key } = await params;
  const query = await searchParams;
  const { ctx } = await requireStaff(["owner", "manager"], `/admin/agents/${key}`);
  const a = (await agentOverview(ctx)).find((x) => x.key === key);
  if (!a) notFound();
  const runs = (await listRuns(ctx, 50)).filter((r) => r.agentKey === key).slice(0, 8);
  const isOwner = ctx.role === "owner";
  const v = valuesFrom(query);
  const s = a.settings as Record<string, unknown>;
  const val = (k: string, fallback: string) => v[k] ?? fallback;
  const enabled = "enabled" in v || Object.keys(v).length === 0 ? (Object.keys(v).length === 0 ? a.enabled : v.enabled === "on") : false;
  const autonomy = v.autonomy ?? a.autonomy;
  const cap = v.cap ?? (a.usingDefaultCap ? "" : moneyInputValue(a.capMinor, c.currency.exponent));

  return (
    <div className="space-y-6">
      <Notice notice={query.notice} error={query.error} />
      <p>{a.description}</p>
      <p className="text-sm text-muted">
        Spent {money(a.spentMinor)} of {money(a.capMinor)} this month{a.usingDefaultCap ? " (the restaurant's default)" : ""}.
      </p>
      {!isOwner && <p className="rounded-lg border border-line-strong bg-surface p-3 text-sm">Only an owner can change an agent&apos;s settings. You can read them here and decide the suggestions in the queue.</p>}

      <form action={saveAgentAction} className={`${card} max-w-xl space-y-5 p-5`}>
        <input type="hidden" name="key" value={a.key} />
        <fieldset disabled={!isOwner} className="space-y-5">
          <label className="flex min-h-11 items-center gap-3 font-semibold">
            <input type="checkbox" name="enabled" defaultChecked={enabled} className="h-5 w-5" />
            Switched on
          </label>

          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-semibold">How much may it do on its own?</legend>
            {(["suggest_only", "approve_first", "auto"] as const).map((l) => (
              <label key={l} className="flex cursor-pointer items-start gap-3 rounded-lg border border-line-strong p-3 has-[:checked]:border-brand has-[:checked]:bg-brand-soft">
                <input type="radio" name="autonomy" value={l} defaultChecked={autonomy === l} className="mt-1 h-5 w-5" />
                <span>
                  <span className="block font-semibold">{LEVEL[l].name}</span>
                  <span className="block text-sm text-muted">{LEVEL[l].help}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <div>
            <label htmlFor="cap" className={label}>
              Monthly AI spending limit, in {c.currency.code} <span className="font-normal text-muted">(optional)</span>
            </label>
            <input id="cap" name="cap" defaultValue={cap} inputMode="decimal" className={field} aria-describedby="cap-help" />
            <p id="cap-help" className={hint}>
              The most this agent may spend on the AI model in a month. 0 means it never uses the AI. Empty uses the restaurant&apos;s default of {money(c.agents.defaultMonthlyCapMinor)}.
            </p>
          </div>

          {a.key === WINBACK_KEY && (
            <>
              <div>
                <label htmlFor="lapsedDays" className={label}>
                  Days quiet
                </label>
                <input id="lapsedDays" name="lapsedDays" defaultValue={val("lapsedDays", String(s.lapsedDays))} inputMode="numeric" className={field} aria-describedby="lapsed-help" />
                <p id="lapsed-help" className={hint}>
                  A customer is quiet when their last paid order is at least this many days old (7 to 365).
                </p>
              </div>
              <div>
                <label htmlFor="cooldownDays" className={label}>
                  Days between messages
                </label>
                <input id="cooldownDays" name="cooldownDays" defaultValue={val("cooldownDays", String(s.cooldownDays))} inputMode="numeric" className={field} aria-describedby="cool-help" />
                <p id="cool-help" className={hint}>
                  The same customer is not suggested again for this long (14 to 365).
                </p>
              </div>
              <div>
                <label htmlFor="maxPerRun" className={label}>
                  Customers per run
                </label>
                <input id="maxPerRun" name="maxPerRun" defaultValue={val("maxPerRun", String(s.maxPerRun))} inputMode="numeric" className={field} />
              </div>
              <div>
                <label htmlFor="promoCode" className={label}>
                  Promo code to mention <span className="font-normal text-muted">(optional)</span>
                </label>
                <input id="promoCode" name="promoCode" defaultValue={val("promoCode", typeof s.promoCode === "string" ? s.promoCode : "")} autoCapitalize="characters" className={field} aria-describedby="code-help" />
                <p id="code-help" className={hint}>
                  One of your own promo codes, switched on under Promos. The agent never makes promos. If the code is off, the agent will not run until you fix it.
                </p>
              </div>
            </>
          )}

          {(NUMERIC_AGENT_FIELDS[a.key] ?? []).map((f) => (
            <div key={f.key}>
              <label htmlFor={f.key} className={label}>
                {f.label}
              </label>
              <input id={f.key} name={f.key} defaultValue={val(f.key, String(s[f.key] ?? f.default))} inputMode="numeric" className={field} aria-describedby={`${f.key}-help`} />
              <p id={`${f.key}-help`} className={hint}>
                {f.help}
              </p>
            </div>
          ))}

          {a.key === SUPPORT_KEY && (
            <div>
              <label htmlFor="extraNotes" className={label}>
                Notes for the assistant <span className="font-normal text-muted">(optional)</span>
              </label>
              <textarea id="extraNotes" name="extraNotes" rows={4} maxLength={500} defaultValue={val("extraNotes", String(s.extraNotes ?? ""))} className={field} aria-describedby="notes-help" />
              <p id="notes-help" className={hint}>
                Facts you want answered correctly, such as &quot;Closed on public holidays&quot;. The assistant already knows your menu, opening hours and delivery areas.
              </p>
            </div>
          )}
          {isOwner && (
            <button type="submit" className={button.primary}>
              Save
            </button>
          )}
        </fieldset>
      </form>

      {isOwner && !a.reactive && (
        <form action={runAgentNowAction} className={`${card} space-y-2 p-4`}>
          <input type="hidden" name="key" value={a.key} />
          <h2 className="text-lg font-bold">Run it now</h2>
          <p className="text-sm text-muted">It also runs on its own on a schedule. Running it now only adds suggestions to the queue; nothing is sent or changed until someone approves.</p>
          <button type="submit" className={button.secondary} disabled={!a.enabled}>
            Run now
          </button>
          {!a.enabled && <p className="text-sm text-muted">Switch it on first.</p>}
        </form>
      )}

      {isOwner && a.autonomy === "auto" && (
        <section className={`${card} space-y-3 border-2 border-warn p-4`} aria-labelledby="auto-h">
          <h2 id="auto-h" className="text-lg font-bold">
            Sending to customers without approval
          </h2>
          {a.autoConfirmed ? (
            <form action={confirmAutoSendAction} className="space-y-2">
              <input type="hidden" name="key" value={a.key} />
              <input type="hidden" name="confirm" value="false" />
              <p>
                <strong>This agent may send messages to customers on its own.</strong> Take this back at any time.
              </p>
              <button type="submit" className={button.danger}>
                Take back
              </button>
            </form>
          ) : (
            <form action={confirmAutoSendAction} className="space-y-3">
              <input type="hidden" name="key" value={a.key} />
              <input type="hidden" name="confirm" value="true" />
              <p>
                Right now, messages to customers still wait for approval. To let this agent send them straight away, type <strong>SEND</strong>. Customers will receive what the agent writes without anyone reading it first.
              </p>
              <div>
                <label htmlFor="typed" className={label}>
                  Type SEND to confirm
                </label>
                <input id="typed" name="typed" autoComplete="off" className={field} />
              </div>
              <button type="submit" className={button.danger}>
                Let it send on its own
              </button>
            </form>
          )}
        </section>
      )}

      <section className={`${card} space-y-2 p-4`} aria-labelledby="runs-h">
        <h2 id="runs-h" className="text-lg font-bold">
          Recent runs
        </h2>
        {runs.length === 0 ? (
          <p className="text-muted">It has not run yet.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {runs.map((r) => (
              <li key={r.id} className="py-2">
                {dateTime(r.startedAt)} &middot; {r.status.replace("_", " ")} &middot; {r.trigger} &middot; {r.proposals} {r.proposals === 1 ? "suggestion" : "suggestions"} &middot; cost {money(r.costMinor)}
                {r.error ? <span className="block text-muted">{r.error}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      <Link href="/admin/agents" className={button.quiet}>
        All agents
      </Link>
    </div>
  );
}

export default function AgentPage(props: PageProps<"/admin/agents/[key]">) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold leading-tight">Agent</h1>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-line" role="status" aria-label="Loading" />}>
        <Settings params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
