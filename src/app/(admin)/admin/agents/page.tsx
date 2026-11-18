import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { restaurantConfig as c } from "../../../../../config/restaurant";
import { agentOverview } from "@/agents/admin";
import { ensureAgentsRegistered } from "@/agents/index";
import { requireStaff } from "@/auth/customer";
import { Notice } from "@/components/staff/notice";
import { button, card } from "@/components/ui";
import { dateTime, money } from "@/lib/format";
import { LEVEL } from "./levels";

export const metadata: Metadata = { title: "Agents" };

async function Agents({ searchParams }: { searchParams: PageProps<"/admin/agents">["searchParams"] }) {
  await connection(); // spending is measured over the current month
  ensureAgentsRegistered();
  const params = await searchParams;
  const { ctx } = await requireStaff(["owner", "manager"], "/admin/agents");
  const agents = await agentOverview(ctx);
  const waiting = agents.reduce((n, a) => n + a.pending, 0);

  return (
    <div className="space-y-6">
      <Notice notice={params.notice} error={params.error} />
      {!c.features.ai_agents && (
        <p className="rounded-lg border border-warn bg-warn-soft p-4" role="status">
          Agents are switched off for this restaurant (<code>features.ai_agents</code> in the config), so none of them runs.
        </p>
      )}
      <p className="text-muted">
        Agents only suggest. Nothing is sent or changed until you approve it, unless an owner has set an agent to act on its own and confirmed that separately.
      </p>
      <Link href="/admin/agents/proposals" className={`${card} flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-brand-soft ${waiting > 0 ? "border-2 border-brand" : ""}`}>
        <span className="text-lg font-semibold">{waiting === 0 ? "No suggestions are waiting" : `${waiting} ${waiting === 1 ? "suggestion is" : "suggestions are"} waiting for you`}</span>
        <span className="font-semibold text-brand">Open the queue</span>
      </Link>

      <ul className="space-y-3">
        {agents.map((a) => (
          <li key={a.key} className={`${card} space-y-2 p-4`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-bold">{a.title}</h2>
              <span className={`rounded-full border px-3 py-1 text-sm font-semibold ${a.enabled ? "border-ok bg-ok-soft" : "border-line-strong bg-surface"}`}>{a.enabled ? "On" : "Off"}</span>
            </div>
            <p>{a.description}</p>
            <p className="text-sm text-muted">
              {LEVEL[a.autonomy].name}
              {a.autonomy === "auto" && !a.autoConfirmed ? ". Messages to customers still wait for approval until an owner confirms." : ""} &middot; Spent {money(a.spentMinor)} of {money(a.capMinor)} this month
              {a.usingDefaultCap ? " (the restaurant's default)" : ""}
              {a.capMinor === 0 ? ". With a limit of zero it never uses the AI, and sticks to standard wording." : ""}
            </p>
            <p className="text-sm text-muted">
              {a.pending > 0 ? `${a.pending} waiting. ` : ""}
              {a.lastRun ? `Last ran ${dateTime(a.lastRun.startedAt)} (${a.lastRun.status.replace("_", " ")}).` : "Has not run yet."}
            </p>
            <Link href={`/admin/agents/${a.key}`} className={button.secondary}>
              {ctx.role === "owner" ? "Settings" : "See settings"}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function AgentsPage(props: PageProps<"/admin/agents">) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold leading-tight">Agents</h1>
      <Suspense fallback={<div className="h-40 animate-pulse rounded-xl bg-line" role="status" aria-label="Loading agents" />}>
        <Agents searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
