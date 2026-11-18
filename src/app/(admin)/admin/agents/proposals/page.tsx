import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { listProposals, listRuns } from "@/agents/admin";
import { ensureAgentsRegistered } from "@/agents/index";
import { listAgents } from "@/agents/registry";
import { requireStaff } from "@/auth/customer";
import { Notice } from "@/components/staff/notice";
import { button, card } from "@/components/ui";
import { dateTime, money } from "@/lib/format";
import { decideProposalAction } from "../actions";

export const metadata: Metadata = { title: "Suggestions" };

async function Queue({ searchParams }: { searchParams: PageProps<"/admin/agents/proposals">["searchParams"] }) {
  await connection();
  ensureAgentsRegistered();
  const params = await searchParams;
  const { ctx } = await requireStaff(["owner", "manager"], "/admin/agents/proposals");
  const [waiting, recent, runs] = await Promise.all([listProposals(ctx, "waiting"), listProposals(ctx, "recent"), listRuns(ctx, 10)]);
  const title = (key: string) => listAgents().find((a) => a.key === key)?.title ?? key;

  return (
    <div className="space-y-8">
      <Notice notice={params.notice} error={params.error} />

      <section className="space-y-3" aria-labelledby="wait-h">
        <h2 id="wait-h" className="text-xl font-bold">
          Waiting for you
        </h2>
        {waiting.length === 0 && <p className={`${card} p-5 text-muted`}>Nothing is waiting. Suggestions from the agents appear here.</p>}
        {waiting.map((p) => (
          <article key={p.id} className={`${card} space-y-3 p-4`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">{title(p.agentKey)}</p>
              <span className="text-sm text-muted">{dateTime(p.createdAt)}</span>
            </div>
            <p>{p.summary}</p>
            {p.customerFacing && <p className="rounded-lg bg-warn-soft p-2 text-sm font-semibold">A customer will read this if you approve it.</p>}
            {p.mode === "advice" ? (
              <div className="space-y-2">
                <p className="text-sm text-muted">This agent is set to suggest only, so this is advice. You can do it yourself, or dismiss it.</p>
                <form action={decideProposalAction}>
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="decision" value="reject" />
                  <button type="submit" className={button.secondary}>
                    Dismiss
                  </button>
                </form>
              </div>
            ) : (
              <div className="flex flex-wrap gap-3">
                <form action={decideProposalAction}>
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="decision" value="approve" />
                  <button type="submit" className={button.primary}>
                    {p.customerFacing ? "Approve and send" : "Approve"}
                  </button>
                </form>
                <form action={decideProposalAction}>
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="decision" value="reject" />
                  <button type="submit" className={button.secondary}>
                    Reject
                  </button>
                </form>
              </div>
            )}
          </article>
        ))}
      </section>

      <section className="space-y-3" aria-labelledby="done-h">
        <h2 id="done-h" className="text-xl font-bold">
          Recently dealt with
        </h2>
        {recent.length === 0 && <p className="text-muted">Nothing yet.</p>}
        <ul className="divide-y divide-line text-sm">
          {recent.slice(0, 30).map((p) => (
            <li key={p.id} className="py-2">
              <span className="font-semibold capitalize">{p.status}</span> &middot; {title(p.agentKey)} &middot; {dateTime(p.decidedAt ?? p.createdAt)}
              <span className="block">{p.summary}</span>
              {p.error && <span className="block font-semibold text-bad">Could not be carried out: {p.error}</span>}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2" aria-labelledby="runs-h">
        <h2 id="runs-h" className="text-xl font-bold">
          Recent runs
        </h2>
        <ul className="divide-y divide-line text-sm">
          {runs.map((r) => (
            <li key={r.id} className="py-2">
              {dateTime(r.startedAt)} &middot; {title(r.agentKey)} &middot; {r.status.replace("_", " ")} &middot; cost {money(r.costMinor)}
              {r.error ? <span className="block text-muted">{r.error}</span> : null}
            </li>
          ))}
          {runs.length === 0 && <li className="py-2 text-muted">No runs yet.</li>}
        </ul>
      </section>
      <Link href="/admin/agents" className={button.quiet}>
        All agents
      </Link>
    </div>
  );
}

export default function SuggestionsPage(props: PageProps<"/admin/agents/proposals">) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold leading-tight">Suggestions</h1>
      <Suspense fallback={<div className="h-40 animate-pulse rounded-xl bg-line" role="status" aria-label="Loading" />}>
        <Queue searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
