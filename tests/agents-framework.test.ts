import { sql } from "drizzle-orm";
import { z } from "zod";
import { afterAll, beforeEach, describe, expect, inject, test } from "vitest";
import { restaurantConfig } from "../config/restaurant";
import type { RestaurantConfig } from "../config/schema";
import { CapExceededError, ModelNotPricedError } from "../src/agents/llm";
import { ProposalNotDecidableError, decideProposal, executeProposal, expireProposals, getAgentConfig, runAgent } from "../src/agents/framework";
import { clearRegistry, registerAgent, registerExecutor } from "../src/agents/registry";
import type { Agent, ProposalDraft } from "../src/agents/types";
import { closePools, withSystemContext } from "../src/db/context";
import { ForbiddenError } from "../src/auth/session";
import { MockLLMProvider } from "../src/providers/llm/mock";
import { StubNotificationProvider } from "../src/providers/notification/stub";
import { admin, closeFixtures, makeUser } from "./helpers/fixtures";

const urls = inject("dbUrls");
afterAll(async () => {
  await closePools();
  await closeFixtures();
});

// One kobo per token, so costs are easy to count: an estimate is about (input characters / 4) + the output allowance.
const PRICE = { inputPerMTokMinor: 1_000_000, outputPerMTokMinor: 1_000_000 };
const config = (cap = 0): RestaurantConfig => ({ ...restaurantConfig, agents: { defaultMonthlyCapMinor: cap, modelPrices: { "mock-model": PRICE } } });
const NOW = new Date("2031-06-15T12:00:00Z"); // its own year, so the month's spend is this test file's alone

let n = 0;
const newKey = () => `fx-${Date.now().toString(36)}-${++n}`;
const executed: { text: string }[] = [];
let llm: MockLLMProvider;
let notifications: StubNotificationProvider;

const deps = (over: Record<string, unknown> = {}) => ({ systemUrl: urls.system, appUrl: urls.app, now: NOW, config: config(), llm, notifications, ...over });

beforeEach(() => {
  clearRegistry();
  executed.length = 0;
  llm = new MockLLMProvider();
  notifications = new StubNotificationProvider();
  registerExecutor({
    kind: "test.note",
    payloadSchema: z.object({ text: z.string() }),
    async execute(p) {
      if (p.text === "boom") throw new Error("the executor failed");
      executed.push(p);
      return { done: p.text };
    },
  });
});

function setup(key: string, drafts: (ctx: Parameters<Agent["run"]>[0]) => ProposalDraft[] | Promise<ProposalDraft[]>, settings: Record<string, unknown> = {}) {
  registerAgent({ key, title: key, description: "test", settingsSchema: z.object({ limit: z.number().default(5) }), defaultSettings: { limit: 5 }, run: async (ctx) => drafts(ctx) } satisfies Agent<{ limit: number }, unknown>);
  return admin().query(`insert into agent_configs (agent_key, enabled, autonomy, settings) values ($1, true, 'suggest_only', $2)`, [key, JSON.stringify(settings)]);
}
const configure = (key: string, set: string, ...values: unknown[]) => admin().query(`update agent_configs set ${set} where agent_key = $${values.length + 1}`, [...values, key]);
const draft = (text: string, over: Partial<ProposalDraft> = {}): ProposalDraft => ({ kind: "test.note", summary: `Note: ${text}`, payload: { text }, customerFacing: false, ...over });
const proposals = async (key: string) => (await admin().query(`select id, status, mode, customer_facing, error, dedupe_key from agent_proposals where agent_key = $1 order by created_at, id`, [key])).rows;
const runRow = async (id: string) => (await admin().query(`select status, error, proposals, cost_minor::int as cost, input_tokens, output_tokens, model, finished_at from agent_runs where id = $1`, [id])).rows[0];
const audits = async (action: string, key: string) => (await admin().query(`select actor_role from audit_log where action = $1 and target_id = $2 order by created_at`, [action, key])).rows.map((r) => r.actor_role);

describe("running an agent", () => {
  test("an agent that is switched off does nothing, and the run says so", async () => {
    const key = newKey();
    await setup(key, () => [draft("never")]);
    await configure(key, "enabled = false");
    const r = await runAgent(key, { trigger: "manual" }, deps());
    expect(r).toMatchObject({ status: "skipped", proposalIds: [] });
    expect(await runRow(r.runId)).toMatchObject({ status: "skipped", error: "The agent is switched off" });
    expect(await proposals(key)).toEqual([]);
  });

  test("an agent with no saved config at all is off, never running by accident", async () => {
    const key = newKey();
    registerAgent({ key, title: key, description: "t", settingsSchema: z.object({}), defaultSettings: {}, run: async () => [draft("x")] });
    expect((await runAgent(key, { trigger: "schedule" }, deps())).status).toBe("skipped");
    expect(await getAgentConfig(key, deps())).toMatchObject({ enabled: false, autonomy: "suggest_only", autoConfirmed: false, monthlyCapMinor: null });
  });

  test("a run is recorded with its trigger and who started it, and writes an audit entry", async () => {
    const key = newKey();
    await setup(key, () => [draft("a")]);
    const me = await makeUser("manager");
    const r = await runAgent(key, { trigger: "manual", startedBy: me.userId }, deps());
    expect(await runRow(r.runId)).toMatchObject({ status: "succeeded", proposals: 1 });
    expect((await admin().query(`select trigger, started_by from agent_runs where id = $1`, [r.runId])).rows[0]).toEqual({ trigger: "manual", started_by: me.userId });
    expect(await audits("agent.run", key)).toEqual(["staff"]);
  });

  test("the agent gets its saved settings merged over its defaults, and a bad setting fails the run without storing anything", async () => {
    const key = newKey();
    let seen = 0;
    await setup(key, (ctx) => {
      seen = (ctx.settings as { limit: number }).limit;
      return [];
    }, { limit: 9 });
    await runAgent(key, { trigger: "manual" }, deps());
    expect(seen).toBe(9);
    await configure(key, "settings = $1", JSON.stringify({ limit: "lots" }));
    const bad = await runAgent(key, { trigger: "manual" }, deps());
    expect(bad.status).toBe("failed");
    expect(await proposals(key)).toEqual([]);
  });

  test("an agent that throws fails the run, stores nothing, and the error is kept", async () => {
    const key = newKey();
    await setup(key, () => {
      throw new Error("the agent broke");
    });
    const r = await runAgent(key, { trigger: "schedule" }, deps());
    expect(r).toMatchObject({ status: "failed", error: "the agent broke" });
    expect(await runRow(r.runId)).toMatchObject({ status: "failed", error: "the agent broke" });
  });
});

describe("what happens to proposals", () => {
  test("suggest_only stores advice that waits and is never carried out", async () => {
    const key = newKey();
    await setup(key, () => [draft("advice")]);
    await runAgent(key, { trigger: "manual" }, deps());
    expect(await proposals(key)).toMatchObject([{ status: "pending", mode: "advice" }]);
    expect(executed).toEqual([]);
  });

  test("approve_first waits for a person", async () => {
    const key = newKey();
    await setup(key, () => [draft("wait")]);
    await configure(key, "autonomy = 'approve_first'");
    await runAgent(key, { trigger: "manual" }, deps());
    expect(await proposals(key)).toMatchObject([{ status: "pending", mode: "approve" }]);
    expect(executed).toEqual([]);
  });

  test("auto carries out what no customer will read, at once", async () => {
    const key = newKey();
    await setup(key, () => [draft("internal")]);
    await configure(key, "autonomy = 'auto'");
    await runAgent(key, { trigger: "schedule" }, deps());
    expect(await proposals(key)).toMatchObject([{ status: "executed", mode: "auto" }]);
    expect(executed).toEqual([{ text: "internal" }]);
  });

  test("auto does NOT send anything a customer will read until an owner has confirmed it: it waits for approval instead", async () => {
    const key = newKey();
    await setup(key, () => [draft("to a customer", { customerFacing: true })]);
    await configure(key, "autonomy = 'auto'");
    await runAgent(key, { trigger: "manual" }, deps());
    expect(await proposals(key)).toMatchObject([{ status: "pending", mode: "approve", customer_facing: true }]);
    expect(executed).toEqual([]);
  });

  test("once an owner has confirmed, customer-facing proposals run at once", async () => {
    const key = newKey();
    await setup(key, () => [draft("to a customer", { customerFacing: true })]);
    await configure(key, "autonomy = 'auto', auto_confirmed_at = now()");
    await runAgent(key, { trigger: "schedule" }, deps());
    expect(await proposals(key)).toMatchObject([{ status: "executed", mode: "auto" }]);
    expect(executed).toEqual([{ text: "to a customer" }]);
  });

  test("running an agent by hand never carries anything out, even in automatic mode: the suggestions wait for approval", async () => {
    const key = newKey();
    await setup(key, () => [draft("by hand", { customerFacing: true })]);
    await configure(key, "autonomy = 'auto', auto_confirmed_at = now()");
    await runAgent(key, { trigger: "manual" }, deps());
    expect(await proposals(key)).toMatchObject([{ status: "pending", mode: "approve" }]);
    expect(executed).toEqual([]);
  });

  test("a proposal marked neverAuto waits for a person even when everything is switched to automatic and confirmed", async () => {
    const key = newKey();
    await setup(key, () => [draft("block someone", { customerFacing: true, neverAuto: true })]);
    await configure(key, "autonomy = 'auto', auto_confirmed_at = now()");
    await runAgent(key, { trigger: "schedule" }, deps());
    expect(await proposals(key)).toMatchObject([{ status: "pending", mode: "approve" }]);
    expect(executed).toEqual([]);
  });

  test("an executor that fails marks the proposal failed with the error, and the run is still a success", async () => {
    const key = newKey();
    await setup(key, () => [draft("boom"), draft("fine")]);
    await configure(key, "autonomy = 'auto'");
    const r = await runAgent(key, { trigger: "schedule" }, deps());
    expect(r.status).toBe("succeeded");
    expect(await proposals(key)).toMatchObject([{ status: "failed", error: "the executor failed" }, { status: "executed" }]);
    expect(executed).toEqual([{ text: "fine" }]);
    expect(await audits("agent.proposal.failed", key)).toEqual(["system"]);
  });

  test("a proposal of a kind nothing can carry out, or with a payload that does not fit, fails the whole run and stores none", async () => {
    const key = newKey();
    await setup(key, () => [draft("good"), { ...draft("x"), kind: "nobody.knows" }]);
    expect((await runAgent(key, { trigger: "manual" }, deps())).status).toBe("failed");
    expect(await proposals(key)).toEqual([]);
    clearRegistry();
    registerExecutor({ kind: "test.note", payloadSchema: z.object({ text: z.string() }), execute: async () => ({}) });
    const key2 = newKey();
    await setup(key2, () => [{ ...draft("x"), payload: { text: 42 } }]);
    expect((await runAgent(key2, { trigger: "manual" }, deps())).status).toBe("failed");
    expect(await proposals(key2)).toEqual([]);
  });

  test("a second run with the same dedupe key does not pile up a second open proposal", async () => {
    const key = newKey();
    await setup(key, () => [draft("same", { dedupeKey: "customer-1" })]);
    await runAgent(key, { trigger: "schedule" }, deps());
    const again = await runAgent(key, { trigger: "schedule" }, deps());
    expect(again.proposalIds).toEqual([]);
    expect(await proposals(key)).toHaveLength(1);
  });
});

describe("deciding", () => {
  async function waiting(autonomy = "approve_first") {
    const key = newKey();
    await setup(key, () => [draft("do it")]);
    await configure(key, "autonomy = $1", autonomy);
    const r = await runAgent(key, { trigger: "manual" }, deps());
    return { key, id: r.proposalIds[0] };
  }

  test("approving carries it out once, records who and when, and audits it", async () => {
    const { key, id } = await waiting();
    const me = await makeUser("manager");
    expect(await decideProposal(me.ctx, id, true, deps())).toBe("executed");
    expect(executed).toEqual([{ text: "do it" }]);
    const row = (await admin().query(`select status, decided_by, decided_at, executed_at, result from agent_proposals where id = $1`, [id])).rows[0];
    expect(row).toMatchObject({ status: "executed", decided_by: me.userId, result: { done: "do it" } });
    expect(row.decided_at).toBeTruthy();
    expect(await audits("agent.proposal.approved", key)).toEqual(["manager"]);
    expect(await audits("agent.proposal.executed", key)).toEqual(["system"]);
  });

  test("rejecting carries out nothing", async () => {
    const { key, id } = await waiting();
    expect(await decideProposal((await makeUser("owner")).ctx, id, false, deps())).toBe("rejected");
    expect(executed).toEqual([]);
    expect((await proposals(key))[0].status).toBe("rejected");
  });

  test("a decided proposal cannot be decided again, and approving twice at once carries it out once", async () => {
    const { id } = await waiting();
    const a = await makeUser("manager");
    const b = await makeUser("owner");
    const results = await Promise.allSettled([decideProposal(a.ctx, id, true, deps()), decideProposal(b.ctx, id, true, deps())]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(executed).toHaveLength(1);
    await expect(decideProposal(a.ctx, id, true, deps())).rejects.toBeInstanceOf(ProposalNotDecidableError);
  });

  test("advice can be dismissed but never approved", async () => {
    const { key, id } = await waiting("suggest_only");
    const me = await makeUser("manager");
    await expect(decideProposal(me.ctx, id, true, deps())).rejects.toBeInstanceOf(ProposalNotDecidableError);
    expect(executed).toEqual([]);
    expect(await decideProposal(me.ctx, id, false, deps())).toBe("rejected");
    expect((await proposals(key))[0].status).toBe("rejected");
  });

  test("changing the autonomy afterwards does not make old advice approvable", async () => {
    const { key, id } = await waiting("suggest_only");
    await configure(key, "autonomy = 'auto', auto_confirmed_at = now()");
    await expect(decideProposal((await makeUser("owner")).ctx, id, true, deps())).rejects.toBeInstanceOf(ProposalNotDecidableError);
    expect(executed).toEqual([]);
  });

  test("an approved proposal whose executor fails is marked failed, and the person is told", async () => {
    const key = newKey();
    await setup(key, () => [draft("boom")]);
    await configure(key, "autonomy = 'approve_first'");
    const r = await runAgent(key, { trigger: "manual" }, deps());
    expect(await decideProposal((await makeUser("manager")).ctx, r.proposalIds[0], true, deps())).toBe("failed");
    expect((await proposals(key))[0]).toMatchObject({ status: "failed", error: "the executor failed" });
  });

  test("the kitchen and customers cannot decide", async () => {
    const { id } = await waiting();
    for (const role of ["kitchen", "customer"] as const) {
      await expect(decideProposal((await makeUser(role)).ctx, id, true, deps()), role).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  test("executing something that is not approved does nothing", async () => {
    const { id } = await waiting();
    expect(await executeProposal(id, deps())).toBe("skipped");
    expect(executed).toEqual([]);
  });

  test("proposals nobody decided by their expiry are closed, and cannot then be approved", async () => {
    const key = newKey();
    await setup(key, () => [draft("old")]);
    await configure(key, "autonomy = 'approve_first'");
    const r = await runAgent(key, { trigger: "manual" }, deps());
    await admin().query(`update agent_proposals set expires_at = $2 where id = $1`, [r.proposalIds[0], new Date(NOW.getTime() - 1000)]);
    expect(await expireProposals(deps())).toBeGreaterThanOrEqual(1);
    expect((await proposals(key))[0].status).toBe("expired");
    await expect(decideProposal((await makeUser("owner")).ctx, r.proposalIds[0], true, deps())).rejects.toBeInstanceOf(ProposalNotDecidableError);
  });
});

describe("an old or in-flight proposal", () => {
  async function waitingToExpire() {
    const key = newKey();
    await setup(key, () => [draft("stale")]);
    await configure(key, "autonomy = 'approve_first'");
    const r = await runAgent(key, { trigger: "schedule" }, deps());
    await admin().query(`update agent_proposals set expires_at = $2 where id = $1`, [r.proposalIds[0], new Date(NOW.getTime() - 1000)]);
    return { key, id: r.proposalIds[0] };
  }

  test("one past its expiry cannot be approved even if the expiry job has not run yet", async () => {
    const { key, id } = await waitingToExpire();
    await expect(decideProposal((await makeUser("owner")).ctx, id, true, deps())).rejects.toBeInstanceOf(ProposalNotDecidableError);
    expect(executed).toEqual([]);
    expect((await proposals(key))[0].status).toBe("pending");
  });

  test("one past its expiry is not carried out, and is closed, even if it was approved before the expiry", async () => {
    const { key, id } = await waitingToExpire();
    await admin().query(`update agent_proposals set status = 'approved' where id = $1`, [id]);
    expect(await executeProposal(id, deps())).toBe("skipped");
    expect(executed).toEqual([]);
    expect((await proposals(key))[0].status).toBe("expired");
  });

  test("while an executor is sending, the proposal is already marked, so a second caller cannot send it again", { timeout: 8000 }, async () => {
    const key = newKey();
    let inner: string | undefined;
    let id = "";
    registerExecutor({
      kind: "test.reentrant",
      payloadSchema: z.object({ text: z.string() }),
      async execute(p) {
        inner = await executeProposal(id, deps()); // a retry, or the other worker, arriving mid-send
        executed.push(p);
        return {};
      },
    });
    await setup(key, () => [draft("once", { kind: "test.reentrant" })]);
    await configure(key, "autonomy = 'auto'");
    const r = await runAgent(key, { trigger: "manual" }, deps());
    id = r.proposalIds[0];
    await admin().query(`update agent_proposals set mode = 'auto' where id = $1`, [id]);
    expect(await executeProposal(id, deps())).toBe("executed");
    expect(inner).toBe("skipped");
    expect(executed).toEqual([{ text: "once" }]);
  });
});

describe("the model and the spend cap", () => {
  const ask = (ctx: Parameters<Agent["run"]>[0], maxOutputTokens = 10) => ctx.llm.complete({ system: "x".repeat(40), messages: [{ role: "user", content: "y".repeat(40) }], schema: z.object({ ok: z.boolean() }), maxOutputTokens });

  test("a cap of zero, the default, lets nothing through to the model, and the run says it was refused", async () => {
    const key = newKey();
    await setup(key, async (ctx) => {
      await ask(ctx);
      return [];
    });
    llm.respondWith({ ok: true });
    const r = await runAgent(key, { trigger: "manual" }, deps({ config: config(0) }));
    expect(r.status).toBe("refused_cap");
    expect(llm.requests).toHaveLength(0);
    expect(await runRow(r.runId)).toMatchObject({ status: "refused_cap", cost: 0 });
  });

  test("a call within the cap goes through and its real cost, tokens and model are recorded", async () => {
    const key = newKey();
    await setup(key, async (ctx) => {
      await ask(ctx, 10);
      return [];
    });
    llm.respondWith({ ok: true });
    const r = await runAgent(key, { trigger: "manual" }, deps({ config: config(1000) }));
    const row = await runRow(r.runId);
    expect(row.status).toBe("succeeded");
    expect(row.input_tokens).toBe(20); // 80 characters over four
    expect(row.output_tokens).toBeGreaterThan(0);
    expect(row.cost).toBe(row.input_tokens + row.output_tokens); // one kobo per token
    expect(row.model).toBe("mock-model");
  });

  test("an agent's own cap in its config beats the restaurant default", async () => {
    const key = newKey();
    await setup(key, async (ctx) => {
      await ask(ctx);
      return [];
    });
    llm.respondWith({ ok: true });
    await configure(key, "monthly_cap_minor = 1000");
    expect((await runAgent(key, { trigger: "manual" }, deps({ config: config(0) }))).status).toBe("succeeded");
  });

  test("earlier runs this month count against the cap, and a call that would pass it is refused before it is made", async () => {
    const key = newKey();
    await setup(key, async (ctx) => {
      await ask(ctx, 10);
      return [];
    });
    llm.respondWith({ ok: true });
    await admin().query(`insert into agent_runs (agent_key, trigger, status, started_at, cost_minor) values ($1, 'schedule', 'succeeded', $2, 980)`, [key, new Date("2031-06-02T10:00:00Z")]);
    const r = await runAgent(key, { trigger: "manual" }, deps({ config: config(1000) })); // 980 used; this call could cost 20 + 10 = 30, which would make 1010
    expect(r.status).toBe("refused_cap");
    expect(llm.requests).toHaveLength(0);
  });

  test("last month's spend does not count against this month", async () => {
    const key = newKey();
    await setup(key, async (ctx) => {
      await ask(ctx);
      return [];
    });
    llm.respondWith({ ok: true });
    await admin().query(`insert into agent_runs (agent_key, trigger, status, started_at, cost_minor) values ($1, 'schedule', 'succeeded', $2, 999999)`, [key, new Date("2031-05-30T10:00:00Z")]);
    expect((await runAgent(key, { trigger: "manual" }, deps({ config: config(1000) }))).status).toBe("succeeded");
  });

  test("another agent's spend does not count against this one", async () => {
    const key = newKey();
    await setup(key, async (ctx) => {
      await ask(ctx);
      return [];
    });
    llm.respondWith({ ok: true });
    await admin().query(`insert into agent_runs (agent_key, trigger, status, started_at, cost_minor) values ('someone-else', 'schedule', 'succeeded', $1, 999999)`, [new Date("2031-06-03T10:00:00Z")]);
    expect((await runAgent(key, { trigger: "manual" }, deps({ config: config(1000) }))).status).toBe("succeeded");
  });

  test("two runs racing for the last of the budget: only one gets to call the model", async () => {
    const key = newKey();
    await setup(key, async (ctx) => {
      await ask(ctx, 10);
      return [];
    });
    llm.respondWith({ ok: true });
    // One call could cost up to 30; a cap of 40 fits one and not two.
    const results = await Promise.all([runAgent(key, { trigger: "manual" }, deps({ config: config(40) })), runAgent(key, { trigger: "manual" }, deps({ config: config(40) }))]);
    expect(results.map((r) => r.status).sort()).toEqual(["refused_cap", "succeeded"]);
    expect(llm.requests).toHaveLength(1);
  });

  test("a model with no price in config cannot be used at all", async () => {
    const key = newKey();
    await setup(key, async (ctx) => {
      await ask(ctx);
      return [];
    });
    llm = new MockLLMProvider("some-other-model");
    llm.respondWith({ ok: true });
    const r = await runAgent(key, { trigger: "manual" }, deps({ config: config(1_000_000) }));
    expect(r.status).toBe("failed");
    expect(r.error).toContain("no price");
    expect(llm.requests).toHaveLength(0);
    expect(ModelNotPricedError).toBeDefined();
  });

  test("a model that fails gives its reserved budget back, so the failure costs nothing", async () => {
    const key = newKey();
    await setup(key, async (ctx) => {
      await ask(ctx);
      return [];
    });
    llm.failNext();
    const r = await runAgent(key, { trigger: "manual" }, deps({ config: config(1000) }));
    expect(r.status).toBe("failed");
    expect(await runRow(r.runId)).toMatchObject({ cost: 0, input_tokens: 0 });
  });

  test("a reply that does not fit the schema is a failure, not an answer", async () => {
    const key = newKey();
    await setup(key, async (ctx) => {
      await ask(ctx);
      return [];
    });
    llm.respondWith({ ok: "maybe" });
    expect((await runAgent(key, { trigger: "manual" }, deps({ config: config(1000) }))).status).toBe("failed");
  });

  test("the cap error is a CapExceededError", () => {
    expect(new CapExceededError("x")).toBeInstanceOf(Error);
  });
});

describe("an agent cannot change anything itself", () => {
  test("its database access is read-only: a write through it fails, and the run fails with it", async () => {
    const key = newKey();
    await setup(key, async (ctx) => {
      await ctx.read((tx) => tx.execute(sql`insert into audit_log (actor_role, action) values ('agent', 'sneaky')`));
      return [];
    });
    const r = await runAgent(key, { trigger: "manual" }, deps());
    expect(r.status).toBe("failed");
    expect((await admin().query(`select 1 from audit_log where action = 'sneaky'`)).rowCount).toBe(0);
  });

  test("it can read", async () => {
    const key = newKey();
    let rows = -1;
    await setup(key, async (ctx) => {
      rows = (await ctx.read((tx) => tx.execute(sql`select 1 from agent_configs where agent_key = ${key}`))).rows.length;
      return [];
    });
    await runAgent(key, { trigger: "manual" }, deps());
    expect(rows).toBe(1);
  });

  test("nothing is sent to a customer by running an agent: only an executor does that", async () => {
    const key = newKey();
    await setup(key, () => [draft("hello", { customerFacing: true })]);
    await runAgent(key, { trigger: "manual" }, deps());
    expect(notifications.sent).toEqual([]);
    await withSystemContext(async () => undefined, { url: urls.system });
  });
});
