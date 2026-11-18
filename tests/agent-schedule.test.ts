import { z } from "zod";
import { afterAll, beforeEach, describe, expect, inject, test } from "vitest";
import { restaurantConfig } from "../config/restaurant";
import { runDueAgents } from "../src/agents/schedule";
import { clearRegistry, registerAgent } from "../src/agents/registry";
import { closePools } from "../src/db/context";
import { MockLLMProvider } from "../src/providers/llm/mock";
import { StubNotificationProvider } from "../src/providers/notification/stub";
import { admin, closeFixtures } from "./helpers/fixtures";

const urls = inject("dbUrls");
// A clock before every other test file's, because the sweep that closes unanswered proposals is global: it must not reach theirs.
const NOW = new Date("2020-06-15T12:00:00Z");
const HOUR = 3_600_000;
afterAll(async () => {
  await closePools();
  await closeFixtures();
});

let n = 0;
let ran: string[];
const deps = (now = NOW) => ({ systemUrl: urls.system, now, config: restaurantConfig, llm: new MockLLMProvider(), notifications: new StubNotificationProvider(), ensure: false });
beforeEach(() => {
  clearRegistry();
  ran = [];
});
function agent(over: { schedule?: { everyMs: number }; reactive?: boolean; enabled?: boolean } = {}) {
  const key = `sch-${Date.now().toString(36)}-${++n}`;
  registerAgent({ key, title: key, description: "t", settingsSchema: z.object({}), defaultSettings: {}, reactive: over.reactive, schedule: "schedule" in over ? over.schedule : { everyMs: 24 * HOUR }, run: async () => (ran.push(key), []) });
  return admin().query(`insert into agent_configs (agent_key, enabled) values ($1, $2)`, [key, over.enabled ?? true]).then(() => key);
}
const lastRun = (key: string, trigger = "schedule") => admin().query(`insert into agent_runs (agent_key, trigger, status, started_at) values ($1, $2, 'succeeded', $3)`, [key, trigger, new Date(NOW.getTime() - 1)]);

describe("runDueAgents", () => {
  test("runs an enabled scheduled agent that has never run, with the schedule as its trigger", async () => {
    const key = await agent();
    const r = await runDueAgents(deps());
    expect(r.ran).toContain(key);
    expect(ran).toContain(key);
    expect((await admin().query(`select trigger from agent_runs where agent_key = $1`, [key])).rows).toEqual([{ trigger: "schedule" }]);
  });

  test("does not run it again before its interval is up, and runs it once the interval has passed", async () => {
    const key = await agent({ schedule: { everyMs: 24 * HOUR } });
    await admin().query(`insert into agent_runs (agent_key, trigger, status, started_at) values ($1, 'schedule', 'succeeded', $2)`, [key, new Date(NOW.getTime() - 23 * HOUR)]);
    expect((await runDueAgents(deps())).ran).not.toContain(key);
    expect((await runDueAgents(deps(new Date(NOW.getTime() + 2 * HOUR)))).ran).toContain(key);
  });

  test("a manual run does not count as the scheduled one", async () => {
    const key = await agent();
    await admin().query(`insert into agent_runs (agent_key, trigger, status, started_at) values ($1, 'manual', 'succeeded', $2)`, [key, new Date(NOW.getTime() - 1)]);
    expect((await runDueAgents(deps())).ran).toContain(key);
  });

  test("a failed run counts as a run, so a broken agent is not retried every few minutes", async () => {
    const key = await agent();
    await admin().query(`insert into agent_runs (agent_key, trigger, status, started_at, error) values ($1, 'schedule', 'failed', $2, 'broke')`, [key, new Date(NOW.getTime() - 1)]);
    expect((await runDueAgents(deps())).ran).not.toContain(key);
  });

  test("skips an agent that is switched off, one with no schedule, and one that reacts to messages", async () => {
    const off = await agent({ enabled: false });
    const noSchedule = await agent({ schedule: undefined });
    const reactive = await agent({ reactive: true, schedule: undefined });
    const r = await runDueAgents(deps());
    for (const k of [off, noSchedule, reactive]) expect(r.ran).not.toContain(k);
    expect(ran).toEqual([]);
  });

  test("closes proposals that nobody decided in time", async () => {
    const key = await agent({ schedule: undefined });
    await lastRun(key);
    const run = (await admin().query(`select id from agent_runs where agent_key = $1`, [key])).rows[0].id as string;
    await admin().query(`insert into agent_proposals (run_id, agent_key, kind, summary, payload, customer_facing, mode, expires_at) values ($1, $2, 'x', 's', '{}', false, 'approve', $3)`, [run, key, new Date(NOW.getTime() - 1000)]);
    expect((await runDueAgents(deps())).expired).toBeGreaterThanOrEqual(1);
    expect((await admin().query(`select status from agent_proposals where agent_key = $1`, [key])).rows[0].status).toBe("expired");
  });

  test("one agent failing does not stop the others", async () => {
    const bad = `sch-bad-${Date.now().toString(36)}`;
    registerAgent({ key: bad, title: bad, description: "t", settingsSchema: z.object({}), defaultSettings: {}, schedule: { everyMs: HOUR }, run: async () => { throw new Error("nope"); } });
    await admin().query(`insert into agent_configs (agent_key, enabled) values ($1, true)`, [bad]);
    const good = await agent();
    const r = await runDueAgents(deps());
    expect(r.ran).toEqual(expect.arrayContaining([bad, good]));
    expect(ran).toContain(good);
  });
});
