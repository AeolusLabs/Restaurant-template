import { afterAll, beforeAll, beforeEach, describe, expect, inject, test } from "vitest";
import { restaurantConfig } from "../config/restaurant";
import type { RestaurantConfig } from "../config/schema";
import { decideProposal, runAgent } from "../src/agents/framework";
import { ensureAgentsRegistered } from "../src/agents/index";
import { WINBACK_KEY } from "../src/agents/winback";
import { closePools } from "../src/db/context";
import { MockLLMProvider } from "../src/providers/llm/mock";
import { StubNotificationProvider } from "../src/providers/notification/stub";
import { admin, closeFixtures, makeOrder, makeUser } from "./helpers/fixtures";

const urls = inject("dbUrls");
const NOW = new Date("2032-06-15T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const PRICE = { inputPerMTokMinor: 1_000_000, outputPerMTokMinor: 1_000_000 };
const config = (cap = 0): RestaurantConfig => ({ ...restaurantConfig, name: "Test Kitchen", agents: { defaultMonthlyCapMinor: cap, modelPrices: { "mock-model": PRICE } } });
let llm: MockLLMProvider;
let notifications: StubNotificationProvider;
const deps = (over: Record<string, unknown> = {}) => ({ systemUrl: urls.system, appUrl: urls.app, now: NOW, config: config(), llm, notifications, ...over });

beforeAll(() => ensureAgentsRegistered());
afterAll(async () => {
  await closePools();
  await closeFixtures();
});
beforeEach(async () => {
  llm = new MockLLMProvider();
  llm.respondWith({ message: "Hi {name}, we miss you! Come back soon for {dish}." });
  notifications = new StubNotificationProvider();
  // The agent's saved config is shared by every test here, so each starts from the same: on, suggest-only, default settings.
  await admin().query(
    `insert into agent_configs (agent_key, enabled, autonomy, auto_confirmed_at, settings, monthly_cap_minor) values ($1, true, 'suggest_only', null, '{}', null)
     on conflict (agent_key) do update set enabled = true, autonomy = 'suggest_only', auto_confirmed_at = null, settings = '{}', monthly_cap_minor = null`,
    [WINBACK_KEY],
  );
  // Proposals from earlier tests would cool their customers down; each test uses its own customers, so nothing to clear.
});
const configure = (set: string, ...values: unknown[]) => admin().query(`update agent_configs set ${set} where agent_key = $${values.length + 1}`, [...values, WINBACK_KEY]);

type Who = { name?: string; phone?: string | null; consent?: "active" | "withdrawn" | "none"; blocked?: boolean; lastPaidDaysAgo?: number | null; dish?: string; orderPhone?: string };
async function customer(w: Who = {}) {
  const u = await makeUser("customer");
  await admin().query(`update profiles set full_name = $2, phone = $3, blocked_at = $4 where id = $1`, [u.userId, w.name ?? "Ada Okafor", w.phone === undefined ? "+2348031112222" : w.phone, w.blocked ? new Date() : null]);
  if ((w.consent ?? "active") !== "none") {
    await admin().query(`insert into consents (profile_id, type, policy_version, granted_at, withdrawn_at) values ($1, 'marketing', 'v1', $2, $3)`, [u.userId, daysAgo(200), w.consent === "withdrawn" ? daysAgo(100) : null]);
  }
  if (w.lastPaidDaysAgo !== null) {
    const { orderId } = await makeOrder(u.userId, "completed");
    const paidAt = daysAgo(w.lastPaidDaysAgo ?? 60);
    await admin().query(`insert into payments (order_id, provider, reference, amount_minor, currency, status, paid_at) values ($1, 'mock', $2, 100000, 'NGN', 'succeeded', $3)`, [orderId, `pay-${orderId}`, paidAt]);
    await admin().query(`insert into order_items (order_id, name_snapshot, unit_price_minor_snapshot, quantity, line_total_minor) values ($1, $2, 100000, 1, 100000)`, [orderId, w.dish ?? "Jollof Rice"]);
    if (w.orderPhone) await admin().query(`insert into order_contacts (order_id, phone) values ($1, $2)`, [orderId, w.orderPhone]);
  }
  return u.userId;
}
const run = async (over: Record<string, unknown> = {}) => runAgent(WINBACK_KEY, { trigger: "schedule" }, deps(over));
const proposed = async (runId: string) => (await admin().query(`select payload, summary, mode, status, customer_facing from agent_proposals where run_id = $1`, [runId])).rows;
const profileIds = (rows: { payload: { profileId: string } }[]) => rows.map((r) => r.payload.profileId);

describe("who is picked", () => {
  test("a customer who agreed to marketing, has a phone and last ordered long enough ago", async () => {
    const id = await customer({ lastPaidDaysAgo: 60 });
    const r = await run();
    expect(r.status).toBe("succeeded");
    expect(profileIds(await proposed(r.runId))).toContain(id);
  });

  test("never a customer who has not agreed, has withdrawn, or never answered about marketing", async () => {
    const none = await customer({ consent: "none" });
    const withdrawn = await customer({ consent: "withdrawn" });
    const ok = await customer();
    const ids = profileIds(await proposed((await run()).runId));
    expect(ids).toContain(ok);
    expect(ids).not.toContain(none);
    expect(ids).not.toContain(withdrawn);
  });

  test("a customer who withdrew after agreeing is out, and one who agreed again after withdrawing is back in", async () => {
    const a = await customer();
    await admin().query(`insert into consents (profile_id, type, policy_version, granted_at, withdrawn_at) values ($1, 'marketing', 'v2', $2, $3)`, [a, daysAgo(10), daysAgo(5)]);
    const b = await customer({ consent: "withdrawn" });
    await admin().query(`insert into consents (profile_id, type, policy_version, granted_at) values ($1, 'marketing', 'v2', $2)`, [b, daysAgo(10)]);
    const ids = profileIds(await proposed((await run()).runId));
    expect(ids).not.toContain(a);
    expect(ids).toContain(b);
  });

  test("never someone who ordered recently, who never ordered, who is blocked, or who has no phone anywhere", async () => {
    const recent = await customer({ lastPaidDaysAgo: 10 });
    const never = await customer({ lastPaidDaysAgo: null });
    const blocked = await customer({ blocked: true });
    const noPhone = await customer({ phone: null });
    const ids = profileIds(await proposed((await run()).runId));
    for (const id of [recent, never, blocked, noPhone]) expect(ids).not.toContain(id);
  });

  test("with no phone on the profile, the number they gave on their last order is used", async () => {
    const id = await customer({ phone: null, orderPhone: "+2348099998888" });
    const rows = await proposed((await run()).runId);
    expect(rows.find((x) => x.payload.profileId === id)?.payload.phone).toBe("+2348099998888");
  });

  test("the threshold is in the agent's settings, and is inclusive of the day it passes", async () => {
    const id = await customer({ lastPaidDaysAgo: 20 });
    expect(profileIds(await proposed((await run()).runId))).not.toContain(id); // default is 45 days
    await configure("settings = $1", JSON.stringify({ lapsedDays: 14 }));
    expect(profileIds(await proposed((await run()).runId))).toContain(id);
  });

  test("most recent first, and no more than the limit", async () => {
    const tag = "Limit";
    const [oldest, middle, newest] = [await customer({ name: `${tag} A`, lastPaidDaysAgo: 300 }), await customer({ name: `${tag} B`, lastPaidDaysAgo: 100 }), await customer({ name: `${tag} C`, lastPaidDaysAgo: 50 })];
    await configure("settings = $1", JSON.stringify({ maxPerRun: 1 }));
    const first = await proposed((await run()).runId);
    expect(first).toHaveLength(1);
    // Whoever was most recently lapsed among everyone eligible is the one proposed; ours are in recency order.
    await configure("settings = $1", JSON.stringify({ maxPerRun: 100 }));
    const all = profileIds(await proposed((await run()).runId));
    const order = [newest, middle, oldest].map((id) => all.indexOf(id)).filter((i) => i >= 0);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  test("the same customer is not proposed again within the cooldown, but is after it", async () => {
    const id = await customer();
    const first = await run();
    expect(profileIds(await proposed(first.runId))).toContain(id);
    await admin().query(`update agent_proposals set status = 'rejected' where run_id = $1`, [first.runId]);
    expect(profileIds(await proposed((await run()).runId))).not.toContain(id); // still cooling down
    const later = await run({ now: new Date(NOW.getTime() + 100 * 86_400_000) });
    expect(profileIds(await proposed(later.runId))).toContain(id); // 100 days on, past the 90-day cooldown
  });

  test("no one eligible means no proposals, and the model is never asked", async () => {
    await customer({ lastPaidDaysAgo: 200 }); // would qualify at 45 days, but not at a year
    await configure("settings = $1", JSON.stringify({ lapsedDays: 365 }));
    const r = await run({ config: config(10_000) });
    expect(r).toMatchObject({ status: "succeeded", proposalIds: [] });
    expect(llm.requests).toHaveLength(0);
  });
});

describe("the message", () => {
  test("is written by the model once for the whole batch, then personalised with each customer's first name and favourite dish", async () => {
    const a = await customer({ name: "Ada Okafor", dish: "Pepper Soup" });
    const b = await customer({ name: "Tunde Bello", dish: "Fried Rice" });
    const r = await run({ config: config(10_000) });
    const rows = await proposed(r.runId);
    expect(llm.requests).toHaveLength(1);
    expect(rows.find((x) => x.payload.profileId === a)?.payload.text).toBe("Hi Ada, we miss you! Come back soon for Pepper Soup.");
    expect(rows.find((x) => x.payload.profileId === b)?.payload.text).toBe("Hi Tunde, we miss you! Come back soon for Fried Rice.");
    expect(rows.find((x) => x.payload.profileId === a)?.payload.wording).toBe("model");
  });

  test("with a cap of zero, the fixed wording is used, nothing is spent, and the run still succeeds", async () => {
    const id = await customer({ name: "Ngozi Eze", dish: "Zobo" });
    const r = await run({ config: config(0) });
    expect(r.status).toBe("succeeded");
    expect(llm.requests).toHaveLength(0);
    const p = (await proposed(r.runId)).find((x) => x.payload.profileId === id)!;
    expect(p.payload.wording).toBe("template");
    expect(p.payload.text).toContain("Ngozi");
    expect(p.payload.text).toContain("Zobo");
    expect(p.summary).toContain("standard wording");
  });

  test("if the model fails, or writes something unsafe, the fixed wording is used instead", async () => {
    const id = await customer();
    llm.failNext();
    const failed = await run({ config: config(10_000) });
    expect(failed.status).toBe("succeeded");
    expect((await proposed(failed.runId)).find((x) => x.payload.profileId === id)?.payload.wording).toBe("template");
  });

  test("model wording with a link, an unknown placeholder or no room is refused and replaced", async () => {
    for (const bad of ["Hi {name}, visit http://evil.example for a treat today", "Hi {name}, use {secret} for a treat today please", "Hi"]) {
      const id = await customer({ name: "Chidi Obi" });
      llm.respondWith({ message: bad });
      const r = await run({ config: config(10_000) });
      const p = (await proposed(r.runId)).find((x) => x.payload.profileId === id)!;
      expect(p.payload.wording, bad).toBe("template");
      expect(p.payload.text, bad).not.toMatch(/evil|secret/);
    }
  });

  test("a promo code chosen by a manager is mentioned, whether or not the model remembers to", async () => {
    await admin().query(`insert into promos (code, kind, value) values ('COMEBACK', 'fixed', 50000) on conflict (code) do update set active = true, expires_at = null`);
    await configure("settings = $1", JSON.stringify({ promoCode: "comeback" }));
    const id = await customer();
    const r = await run({ config: config(10_000) });
    expect((await proposed(r.runId)).find((x) => x.payload.profileId === id)?.payload.text).toContain("COMEBACK");
    const id2 = await customer();
    const r2 = await run({ config: config(0) });
    expect((await proposed(r2.runId)).find((x) => x.payload.profileId === id2)?.payload.text).toContain("COMEBACK");
  });

  test("a promo code that is switched off or does not exist fails the run with a clear reason, and proposes nothing", async () => {
    await admin().query(`insert into promos (code, kind, value, active) values ('OFFCODE', 'fixed', 50000, false) on conflict (code) do update set active = false`);
    for (const code of ["OFFCODE", "NOSUCHCODE"]) {
      await configure("settings = $1", JSON.stringify({ promoCode: code }));
      await customer();
      const r = await run();
      expect(r.status, code).toBe("failed");
      expect(r.error, code).toContain(code);
      expect(await proposed(r.runId)).toEqual([]);
    }
  });
});

describe("what is proposed, and what is sent", () => {
  test("by default the proposals are advice, customer-facing, and nothing is sent", async () => {
    const id = await customer();
    const r = await run();
    const p = (await proposed(r.runId)).find((x) => x.payload.profileId === id)!;
    expect(p).toMatchObject({ mode: "advice", status: "pending", customer_facing: true });
    expect(notifications.sent).toEqual([]);
  });

  test("approved by a manager, the message is sent by WhatsApp with the customer's name and text", async () => {
    await configure("autonomy = 'approve_first'");
    const id = await customer({ name: "Ada Okafor", phone: "+2348031112222" });
    const r = await run({ config: config(10_000) });
    const proposalId = r.proposalIds[(await proposed(r.runId)).findIndex((x) => x.payload.profileId === id)];
    expect(await decideProposal((await makeUser("manager")).ctx, proposalId, true, deps())).toBe("executed");
    const sent = notifications.sent.filter((m) => m.to === "+2348031112222");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ channel: "whatsapp", template: "winback", vars: { name: "Ada" } });
    expect(sent[0].vars.text).toContain("Ada");
  });

  test("if the customer withdraws marketing consent after the proposal, approving it sends nothing and fails with the reason", async () => {
    await configure("autonomy = 'approve_first'");
    const id = await customer({ phone: "+2348055550001" });
    const r = await run();
    const proposalId = r.proposalIds[(await proposed(r.runId)).findIndex((x) => x.payload.profileId === id)];
    await admin().query(`insert into consents (profile_id, type, policy_version, granted_at, withdrawn_at) values ($1, 'marketing', 'v2', $2, $2)`, [id, daysAgo(1)]);
    expect(await decideProposal((await makeUser("owner")).ctx, proposalId, true, deps())).toBe("failed");
    expect(notifications.sent.filter((m) => m.to === "+2348055550001")).toEqual([]);
    expect((await admin().query(`select error from agent_proposals where id = $1`, [proposalId])).rows[0].error).toContain("no longer agrees");
  });

  test("if the customer is blocked after the proposal, nothing is sent", async () => {
    await configure("autonomy = 'approve_first'");
    const id = await customer({ phone: "+2348055550002" });
    const r = await run();
    const proposalId = r.proposalIds[(await proposed(r.runId)).findIndex((x) => x.payload.profileId === id)];
    await admin().query(`update profiles set blocked_at = now() where id = $1`, [id]);
    expect(await decideProposal((await makeUser("manager")).ctx, proposalId, true, deps())).toBe("failed");
    expect(notifications.sent.filter((m) => m.to === "+2348055550002")).toEqual([]);
  });

  test("auto without an owner's confirmation still waits for approval; with it, messages go out at once", async () => {
    await configure("autonomy = 'auto'");
    const a = await customer({ phone: "+2348055550003" });
    const unconfirmed = await run();
    expect((await proposed(unconfirmed.runId)).find((x) => x.payload.profileId === a)).toMatchObject({ mode: "approve", status: "pending" });
    expect(notifications.sent.filter((m) => m.to === "+2348055550003")).toEqual([]);
    await configure("auto_confirmed_at = now()");
    const b = await customer({ phone: "+2348055550004" });
    const confirmed = await run();
    expect((await proposed(confirmed.runId)).find((x) => x.payload.profileId === b)).toMatchObject({ mode: "auto", status: "executed" });
    expect(notifications.sent.filter((m) => m.to === "+2348055550004")).toHaveLength(1);
  });

  test("a switched-off agent proposes and sends nothing", async () => {
    await configure("enabled = false");
    await customer({ phone: "+2348055550005" });
    const r = await run();
    expect(r.status).toBe("skipped");
    expect(notifications.sent).toEqual([]);
  });
});
