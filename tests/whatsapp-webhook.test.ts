import { afterAll, beforeAll, beforeEach, describe, expect, inject, test } from "vitest";
import { restaurantConfig } from "../config/restaurant";
import type { RestaurantConfig } from "../config/schema";
import { ensureAgentsRegistered } from "../src/agents/index";
import { registerAgent } from "../src/agents/registry";
import { supportAgent } from "../src/agents/support";
import { handleWhatsAppWebhook } from "../src/agents/whatsapp-webhook";
import { closePools } from "../src/db/context";
import { MockLLMProvider } from "../src/providers/llm/mock";
import { StubNotificationProvider, signStubInbound } from "../src/providers/notification/stub";
import { admin, closeFixtures } from "./helpers/fixtures";

const urls = inject("dbUrls");
const NOW = new Date("2035-06-15T12:00:00Z");
const config = (agents = true): RestaurantConfig => ({
  ...restaurantConfig,
  features: { ...restaurantConfig.features, ai_agents: agents },
  agents: { defaultMonthlyCapMinor: 100_000, modelPrices: { "mock-model": { inputPerMTokMinor: 1_000_000, outputPerMTokMinor: 1_000_000 } } },
});
let provider: StubNotificationProvider;
let llm: MockLLMProvider;
const deps = (over: Record<string, unknown> = {}) => ({ provider, systemUrl: urls.system, appUrl: urls.app, now: NOW, config: config(), llm, notifications: provider, agentKey: SUPPORT_KEY, ...over });

// Its own copy of the agent under a unique key, so no other test file shares its saved settings.
const SUPPORT_KEY = `wh-${Date.now().toString(36)}`;
beforeAll(() => {
  ensureAgentsRegistered();
  registerAgent({ ...supportAgent, key: SUPPORT_KEY });
});
afterAll(async () => {
  await closePools();
  await closeFixtures();
});
beforeEach(async () => {
  provider = new StubNotificationProvider();
  llm = new MockLLMProvider();
  llm.respondWith({ reply: "We open at 10:00.", needsHuman: false });
  await admin().query(
    `insert into agent_configs (agent_key, enabled, autonomy, auto_confirmed_at, settings, monthly_cap_minor) values ($1, true, 'suggest_only', null, '{}', null)
     on conflict (agent_key) do update set enabled = true, autonomy = 'suggest_only', auto_confirmed_at = null, settings = '{}', monthly_cap_minor = null`,
    [SUPPORT_KEY],
  );
});

let n = 0;
let phoneSeq = 5_000_000;
const msg = (over: Record<string, unknown> = {}) => ({ id: `wamid-${Date.now().toString(36)}-${++n}`, from: `+23480${++phoneSeq}`, text: "What time do you open?", ...over });
const post = (m: unknown, d = deps(), sig?: string) => {
  const raw = typeof m === "string" ? m : JSON.stringify(m);
  return handleWhatsAppWebhook(raw, new Headers({ "x-stub-signature": sig ?? signStubInbound(raw) }), d);
};
const runs = async (id: string) => (await admin().query(`select r.status, r.trigger, (select count(*) from agent_proposals p where p.run_id = r.id)::int as proposals from agent_runs r where r.agent_key = $1 and r.id in (select run_id from agent_proposals where dedupe_key = $2) `, [SUPPORT_KEY, `support:${id}`])).rows;
const events = async (id: string) => (await admin().query(`select payload from webhook_events where provider = 'whatsapp' and event_id = $1`, [id])).rows;

describe("an inbound WhatsApp message", () => {
  test("a signed message is accepted, runs the support agent, and leaves a proposal", async () => {
    const m = msg();
    expect(await post(m)).toEqual({ status: 200, outcome: "processed" });
    expect(await runs(m.id)).toEqual([{ status: "succeeded", trigger: "inbound", proposals: 1 }]);
    expect(provider.sent).toEqual([]); // nothing goes to the customer from a webhook alone
  });

  test("the stored event holds who and which message, not what they wrote", async () => {
    const m = msg({ text: "my secret question" });
    await post(m);
    const [e] = await events(m.id);
    expect(e.payload).toEqual({ id: m.id, from: m.from });
    expect(JSON.stringify(e.payload)).not.toContain("secret");
  });

  test("a bad or missing signature is refused with 401 and nothing is stored or run", async () => {
    const m = msg();
    expect((await post(m, deps(), "00".repeat(32))).status).toBe(401);
    expect((await post(m, deps(), "")).status).toBe(401);
    expect(await events(m.id)).toEqual([]);
    expect(llm.requests).toHaveLength(0);
  });

  test("a body that is not a message is 400", async () => {
    for (const bad of ["{not json", {}, { id: "x", from: "+2348012345678" }, { id: "", from: "+2348012345678", text: "hi" }, { id: "x", from: "1", text: "hi" }, { id: "x", from: "+2348012345678", text: "" }]) {
      expect((await post(bad)).status, JSON.stringify(bad)).toBe(400);
    }
  });

  test("a replayed message does nothing the second time", async () => {
    const m = msg();
    expect((await post(m)).outcome).toBe("processed");
    expect(await post(m)).toEqual({ status: 200, outcome: "duplicate" });
    expect(llm.requests).toHaveLength(1);
    expect(await runs(m.id)).toHaveLength(1);
  });

  test("the same message arriving twice at once is processed once", async () => {
    const m = msg();
    const results = await Promise.all([post(m), post(m)]);
    expect(results.map((r) => r.outcome).sort()).toEqual(["duplicate", "processed"]);
    expect(llm.requests).toHaveLength(1);
  });

  test("when the agent is switched off the message is acknowledged and nothing is proposed", async () => {
    await admin().query(`update agent_configs set enabled = false where agent_key = $1`, [SUPPORT_KEY]);
    const m = msg();
    expect(await post(m)).toEqual({ status: 200, outcome: "processed" });
    expect(llm.requests).toHaveLength(0);
    expect(await runs(m.id)).toEqual([]);
  });

  test("when agents are switched off for the restaurant, it is acknowledged and not even stored", async () => {
    const m = msg();
    expect(await post(m, deps({ config: config(false) }))).toEqual({ status: 200, outcome: "agents_off" });
    expect(await events(m.id)).toEqual([]);
    expect(llm.requests).toHaveLength(0);
  });

  test("one number cannot make the restaurant pay for more than ten answers an hour", async () => {
    const from = `+23480${++phoneSeq}`;
    for (let i = 0; i < 10; i++) expect((await post(msg({ from }))).outcome).toBe("processed");
    const flood = msg({ from });
    expect(await post(flood)).toEqual({ status: 200, outcome: "throttled" });
    expect(llm.requests).toHaveLength(10);
    expect(await runs(flood.id)).toEqual([]);
    // Another number is not affected, and an hour later the first can write again.
    expect((await post(msg())).outcome).toBe("processed");
    expect((await post(msg({ from }), deps({ now: new Date(NOW.getTime() + 61 * 60_000) }))).outcome).toBe("processed");
  });
});

describe("the stub's own signature", () => {
  test("is checked on the exact bytes of the body", async () => {
    const m = msg();
    const raw = JSON.stringify(m);
    const sig = signStubInbound(raw);
    expect((await post(`${raw} `, deps(), sig)).status).toBe(401); // one extra space: a different body
    expect((await post(raw, deps(), sig)).status).toBe(200);
  });
});
