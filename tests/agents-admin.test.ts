import { z } from "zod";
import { afterAll, beforeAll, describe, expect, inject, test } from "vitest";
import { restaurantConfig } from "../config/restaurant";
import { AgentConfigError, agentOverview, listProposals, listRuns, saveAgentConfig, setAutoConfirmation } from "../src/agents/admin";
import { UnknownAgentError, registerAgent } from "../src/agents/registry";
import { ForbiddenError } from "../src/auth/session";
import { closePools } from "../src/db/context";
import { admin, closeFixtures, makeUser } from "./helpers/fixtures";

const urls = inject("dbUrls");
const o = { appUrl: urls.app, systemUrl: urls.system };
const NOW = new Date("2036-06-15T12:00:00Z");
const config = { ...restaurantConfig, agents: { defaultMonthlyCapMinor: 250_000, modelPrices: {} } };
const deps = { ...o, now: NOW, config };

// Agents of their own, so these tests never touch the real agents' saved settings, which other test files use at the same time.
const tag = Date.now().toString(36);
const SUPPORT_KEY = `adm-support-${tag}`;
const WINBACK_KEY = `adm-winback-${tag}`;
beforeAll(() => {
  registerAgent({ key: SUPPORT_KEY, title: "Support", description: "d", settingsSchema: z.object({ extraNotes: z.string().max(500).default("") }), defaultSettings: { extraNotes: "" }, reactive: true, run: async () => [] });
  registerAgent({ key: WINBACK_KEY, title: "Win-back", description: "d", settingsSchema: z.object({ lapsedDays: z.number().int().min(7), cooldownDays: z.number().int(), maxPerRun: z.number().int(), promoCode: z.string().nullable() }), defaultSettings: { lapsedDays: 45, cooldownDays: 90, maxPerRun: 20, promoCode: null }, run: async () => [] });
});
afterAll(async () => {
  await closePools();
  await closeFixtures();
});

const save = (ctx: Parameters<typeof saveAgentConfig>[0], key = SUPPORT_KEY, over: Partial<Parameters<typeof saveAgentConfig>[2]> = {}) =>
  saveAgentConfig(ctx, key, { enabled: true, autonomy: "approve_first", monthlyCapMinor: null, settings: key === WINBACK_KEY ? { lapsedDays: 45, cooldownDays: 90, maxPerRun: 20, promoCode: null } : { extraNotes: "" }, ...over }, deps);
const row = async (key: string) => (await admin().query(`select enabled, autonomy, auto_confirmed_at, auto_confirmed_by, monthly_cap_minor::int as cap, settings, updated_by from agent_configs where agent_key = $1`, [key])).rows[0];
const audits = async (action: string, key: string) => (await admin().query(`select actor_role from audit_log where action = $1 and target_id = $2`, [action, key])).rows.map((r) => r.actor_role);
const reset = (key: string) => admin().query(`delete from agent_configs where agent_key = $1`, [key]);

describe("saving an agent's settings", () => {
  test("an owner saves them, and the change is audited", async () => {
    await reset(SUPPORT_KEY);
    const owner = await makeUser("owner");
    await save(owner.ctx, SUPPORT_KEY, { autonomy: "approve_first", monthlyCapMinor: 50_000, settings: { extraNotes: "Closed on holidays." } });
    expect(await row(SUPPORT_KEY)).toMatchObject({ enabled: true, autonomy: "approve_first", cap: 50_000, settings: { extraNotes: "Closed on holidays." }, updated_by: owner.userId });
    expect((await audits("agent.config.updated", SUPPORT_KEY)).length).toBeGreaterThanOrEqual(1);
  });

  test("saving again changes the same row, not a second one", async () => {
    const owner = (await makeUser("owner")).ctx;
    await save(owner, SUPPORT_KEY, { enabled: false });
    expect((await admin().query(`select count(*)::int as n from agent_configs where agent_key = $1`, [SUPPORT_KEY])).rows[0].n).toBe(1);
    expect((await row(SUPPORT_KEY)).enabled).toBe(false);
  });

  test("managers, the kitchen and customers cannot change settings", async () => {
    for (const role of ["manager", "kitchen", "customer"] as const) {
      await expect(save((await makeUser(role)).ctx), role).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  test("settings that do not fit the agent are refused and nothing is saved", async () => {
    const owner = (await makeUser("owner")).ctx;
    await reset(WINBACK_KEY);
    await expect(save(owner, WINBACK_KEY, { settings: { lapsedDays: 2, cooldownDays: 90, maxPerRun: 20, promoCode: null } })).rejects.toBeInstanceOf(AgentConfigError);
    expect(await row(WINBACK_KEY)).toBeUndefined();
  });

  test("an unknown agent is refused", async () => {
    await expect(saveAgentConfig((await makeUser("owner")).ctx, "nobody", { enabled: true, autonomy: "suggest_only", monthlyCapMinor: null, settings: {} }, deps)).rejects.toBeInstanceOf(UnknownAgentError);
  });

  test("a negative cap is refused", async () => {
    await expect(save((await makeUser("owner")).ctx, SUPPORT_KEY, { monthlyCapMinor: -1 })).rejects.toBeInstanceOf(AgentConfigError);
  });
});

describe("letting an agent send to customers on its own", () => {
  test("needs the agent to be on auto, an owner, and the word typed exactly", async () => {
    const owner = await makeUser("owner");
    await save(owner.ctx, SUPPORT_KEY, { autonomy: "approve_first" });
    await expect(setAutoConfirmation(owner.ctx, SUPPORT_KEY, true, "SEND", deps)).rejects.toBeInstanceOf(AgentConfigError); // not on auto
    await save(owner.ctx, SUPPORT_KEY, { autonomy: "auto" });
    for (const typed of ["", "send", "yes", "SEND IT"]) await expect(setAutoConfirmation(owner.ctx, SUPPORT_KEY, true, typed, deps), typed).rejects.toBeInstanceOf(AgentConfigError);
    expect((await row(SUPPORT_KEY)).auto_confirmed_at).toBeNull();
    await setAutoConfirmation(owner.ctx, SUPPORT_KEY, true, " SEND ", deps);
    const r = await row(SUPPORT_KEY);
    expect(r.auto_confirmed_at).toBeTruthy();
    expect(r.auto_confirmed_by).toBe(owner.userId);
    expect(await audits("agent.auto_send.confirmed", SUPPORT_KEY)).toContain("owner");
  });

  test("it can be taken back, with no word needed", async () => {
    const owner = (await makeUser("owner")).ctx;
    await save(owner, SUPPORT_KEY, { autonomy: "auto" });
    await setAutoConfirmation(owner, SUPPORT_KEY, true, "SEND", deps);
    await setAutoConfirmation(owner, SUPPORT_KEY, false, "", deps);
    expect((await row(SUPPORT_KEY)).auto_confirmed_at).toBeNull();
    expect(await audits("agent.auto_send.revoked", SUPPORT_KEY)).toContain("owner");
  });

  test("moving the agent off auto takes the confirmation back, so coming back to auto needs confirming again", async () => {
    const owner = (await makeUser("owner")).ctx;
    await save(owner, SUPPORT_KEY, { autonomy: "auto" });
    await setAutoConfirmation(owner, SUPPORT_KEY, true, "SEND", deps);
    await save(owner, SUPPORT_KEY, { autonomy: "approve_first" });
    expect((await row(SUPPORT_KEY)).auto_confirmed_at).toBeNull();
    await save(owner, SUPPORT_KEY, { autonomy: "auto" });
    expect((await row(SUPPORT_KEY)).auto_confirmed_at).toBeNull();
  });

  test("saving other settings while on auto does not lose the confirmation", async () => {
    const owner = (await makeUser("owner")).ctx;
    await save(owner, SUPPORT_KEY, { autonomy: "auto" });
    await setAutoConfirmation(owner, SUPPORT_KEY, true, "SEND", deps);
    await save(owner, SUPPORT_KEY, { autonomy: "auto", settings: { extraNotes: "Changed." } });
    expect((await row(SUPPORT_KEY)).auto_confirmed_at).toBeTruthy();
  });

  test("a manager cannot confirm", async () => {
    await expect(setAutoConfirmation((await makeUser("manager")).ctx, SUPPORT_KEY, true, "SEND", deps)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("the overview", () => {
  test("lists every agent with its state, this month's spend against its cap, waiting proposals and last run", async () => {
    const owner = (await makeUser("owner")).ctx;
    await save(owner, SUPPORT_KEY, { enabled: true, autonomy: "approve_first", monthlyCapMinor: 100_000 });
    const key = SUPPORT_KEY;
    await admin().query(`insert into agent_runs (agent_key, trigger, status, started_at, cost_minor) values ($1, 'inbound', 'succeeded', $2, 40000), ($1, 'inbound', 'succeeded', $3, 7777)`, [key, new Date("2036-06-02T10:00:00Z"), new Date("2036-05-20T10:00:00Z")]);
    const run = (await admin().query(`select id from agent_runs where agent_key = $1 order by started_at desc limit 1`, [key])).rows[0].id as string;
    await admin().query(`insert into agent_proposals (run_id, agent_key, kind, summary, payload, customer_facing, mode) values ($1, $2, 'x', 's', '{}', false, 'approve')`, [run, key]);
    const all = await agentOverview((await makeUser("manager")).ctx, deps);
    expect(all.map((a) => a.key).sort()).toEqual([SUPPORT_KEY, WINBACK_KEY].sort());
    const s = all.find((a) => a.key === key)!;
    expect(s).toMatchObject({ enabled: true, autonomy: "approve_first", capMinor: 100_000, spentMinor: 40_000 });
    expect(s.pending).toBeGreaterThanOrEqual(1);
    expect(s.lastRun?.status).toBe("succeeded");
  });

  test("an agent with no saved settings shows as off, suggest-only, with the restaurant's default cap", async () => {
    await reset(WINBACK_KEY);
    const w = (await agentOverview((await makeUser("owner")).ctx, deps)).find((a) => a.key === WINBACK_KEY)!;
    expect(w).toMatchObject({ enabled: false, autonomy: "suggest_only", autoConfirmed: false, capMinor: 250_000, usingDefaultCap: true });
  });

  test("the kitchen and customers cannot look", async () => {
    for (const role of ["kitchen", "customer"] as const) await expect(agentOverview((await makeUser(role)).ctx, deps), role).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("proposals and runs", () => {
  async function proposal(status: string, daysAgo = 0) {
    const run = (await admin().query(`insert into agent_runs (agent_key, trigger, status) values ('lp-test', 'manual', 'succeeded') returning id`)).rows[0].id as string;
    const at = new Date(Date.now() - daysAgo * 86_400_000);
    return (await admin().query(`insert into agent_proposals (run_id, agent_key, kind, summary, payload, customer_facing, mode, status, created_at) values ($1, 'lp-test', 'x', $2, '{}', true, 'approve', $3, $4) returning id`, [run, `p-${status}-${daysAgo}`, status, at])).rows[0].id as string;
  }

  test("waiting shows only pending ones, newest first; recent shows the decided ones", async () => {
    const a = await proposal("pending", 2);
    const b = await proposal("pending", 0);
    const c = await proposal("executed", 1);
    const waiting = (await listProposals((await makeUser("manager")).ctx, "waiting", deps)).filter((p) => p.agentKey === "lp-test");
    expect(waiting.map((p) => p.id)).toEqual([b, a]);
    const recent = (await listProposals((await makeUser("owner")).ctx, "recent", deps)).filter((p) => p.agentKey === "lp-test");
    expect(recent.map((p) => p.id)).toContain(c);
    expect(recent.map((p) => p.id)).not.toContain(a);
  });

  test("a proposal carries what the person needs to decide: the summary, whether a customer will read it, and its mode", async () => {
    await proposal("pending", 0);
    const [p] = (await listProposals((await makeUser("manager")).ctx, "waiting", deps)).filter((x) => x.agentKey === "lp-test");
    expect(p).toMatchObject({ kind: "x", customerFacing: true, mode: "approve", status: "pending" });
    expect(p.summary).toContain("pending");
  });

  test("runs are listed newest first with their cost", async () => {
    const runs = await listRuns((await makeUser("manager")).ctx, 5, deps);
    expect(runs.length).toBeGreaterThan(0);
    const times = runs.map((r) => r.startedAt.getTime());
    expect(times).toEqual([...times].sort((x, y) => y - x));
    expect(typeof runs[0].costMinor).toBe("number");
  });

  test("the kitchen and customers cannot look", async () => {
    for (const role of ["kitchen", "customer"] as const) {
      await expect(listProposals((await makeUser(role)).ctx, "waiting", deps), role).rejects.toBeInstanceOf(ForbiddenError);
      await expect(listRuns((await makeUser(role)).ctx, 5, deps), role).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});
