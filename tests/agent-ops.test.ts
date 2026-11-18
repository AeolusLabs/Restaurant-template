import { afterAll, afterEach, beforeAll, describe, expect, inject, test } from "vitest";
import { restaurantConfig } from "../config/restaurant";
import type { RestaurantConfig } from "../config/schema";
import { decideProposal, runAgent } from "../src/agents/framework";
import { ensureAgentsRegistered } from "../src/agents/index";
import { anomalyAgent, demandAgent, menuAgent, watchdogAgent } from "../src/agents/ops-agents";
import { registerAgent } from "../src/agents/registry";
import { closePools } from "../src/db/context";
import { MockLLMProvider } from "../src/providers/llm/mock";
import { StubNotificationProvider } from "../src/providers/notification/stub";
import { admin, closeFixtures, makeOrder, makeUser } from "./helpers/fixtures";

const urls = inject("dbUrls");
const allDay = { open: "00:00", close: "23:59" };
const config: RestaurantConfig = {
  ...restaurantConfig,
  openingHours: { mon: [allDay], tue: [allDay], wed: [allDay], thu: [allDay], fri: [allDay], sat: [allDay], sun: [allDay] },
  agents: { defaultMonthlyCapMinor: 0, modelPrices: {} },
};
const deps = (now: Date, over: Record<string, unknown> = {}) => ({ systemUrl: urls.system, appUrl: urls.app, now, config, llm: new MockLLMProvider(), notifications: new StubNotificationProvider(), ...over });
const DAY = 86_400_000;
const tag = Date.now().toString(36);
afterAll(async () => {
  await closePools();
  await closeFixtures();
});
beforeAll(() => ensureAgentsRegistered());
// Dishes made by one test stay in the shared database, and would look unsold to the next: hide them again.
afterEach(async () => {
  await admin().query(`update menu_items set active = false where slug like $1`, [`%-${tag}-%`]);
});

// Each test works in its own year, so the shared database holds nothing else inside its windows.
let future = 2041;
let past = 2017;
const nextFuture = () => ++future;
const nextPast = () => ++past;
// The watchdog reads every live delivery in the database, so its clock sits before any other test's data (they are all newer, so never look stuck).
let early = 1990;
const nextEarly = () => ++early;

let n = 0;
async function setup(agent: Parameters<typeof registerAgent>[0], autonomy: "suggest_only" | "approve_first" | "auto" = "auto", settings: Record<string, unknown> = {}, confirmed = false) {
  const key = `${(agent as { key: string }).key}-${tag}-${++n}`;
  registerAgent({ ...(agent as object), key } as never);
  await admin().query(`insert into agent_configs (agent_key, enabled, autonomy, settings, auto_confirmed_at) values ($1, true, $2, $3, $4)`, [key, autonomy, JSON.stringify(settings), confirmed ? new Date() : null]);
  return key;
}
const proposals = async (key: string) => (await admin().query(`select kind, summary, payload, mode, status, customer_facing, error from agent_proposals where agent_key = $1 order by created_at, id`, [key])).rows;

async function sale(paidAt: Date, items: { itemId?: string; name: string; quantity: number }[] = [], status: "succeeded" | "refunded" = "succeeded", profileId?: string) {
  const owner = profileId ?? (await makeUser("customer")).userId;
  const { orderId } = await makeOrder(owner, "completed");
  await admin().query(`insert into payments (order_id, provider, reference, amount_minor, currency, status, paid_at) values ($1, 'mock', $2, 100000, 'NGN', $3, $4)`, [orderId, `pay-${orderId}`, status, paidAt]);
  for (const i of items) await admin().query(`insert into order_items (order_id, item_id, name_snapshot, unit_price_minor_snapshot, quantity, line_total_minor) values ($1, $2, $3, 100000, $4, $5)`, [orderId, i.itemId ?? null, i.name, i.quantity, 100000 * i.quantity]);
  return orderId;
}

describe("demand and prep planner", () => {
  // now: the morning of 10 June in its own year; tomorrow is 11 June, and the same weekday one and two weeks before it has history.
  const setupDays = () => {
    const y = nextFuture();
    const now = new Date(Date.UTC(y, 5, 10, 10, 0));
    const tomorrow = Date.UTC(y, 5, 11);
    const noon = new Date(tomorrow + 12 * 3_600_000);
    const long = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "Africa/Lagos" }).format(noon);
    return { now, d1: new Date(tomorrow - 7 * DAY), d2: new Date(tomorrow - 14 * DAY), tomorrow: new Date(tomorrow), weekday: long, weekdayKey: long.slice(0, 3).toLowerCase() as "mon" };
  };
  const at = (day: Date, hourUtc: number) => new Date(day.getTime() + hourUtc * 3_600_000);

  test("proposes a note with the expected orders, the busiest hour and what to prepare", async () => {
    const { now, d1, d2, weekday } = setupDays();
    for (const d of [d1, d2]) {
      await sale(at(d, 11), [{ name: "Jollof Rice", quantity: 2 }]);
      await sale(at(d, 11), [{ name: "Jollof Rice", quantity: 2 }]);
      for (let i = 0; i < 3; i++) await sale(at(d, 18), [{ name: "Zobo", quantity: 1 }]);
    }
    const key = await setup(demandAgent, "approve_first");
    const r = await runAgent(key, { trigger: "schedule" }, deps(now));
    expect(r.error).toBeUndefined();
    expect(r.status).toBe("succeeded");
    const [p] = await proposals(key);
    expect(p).toMatchObject({ kind: "insight.note", customer_facing: false, mode: "approve" });
    expect(p.payload.title).toBe(`Tomorrow, ${weekday}: about 5 orders`);
    expect(p.payload.detail).toContain("19:00"); // 18:00 UTC is 19:00 in Lagos
    expect(p.payload.detail).toContain("Jollof Rice (about 4)");
    expect(p.payload.detail).toContain("Zobo (about 3)");
  });

  test("with only one earlier such day it says nothing rather than guess", async () => {
    const { now, d1 } = setupDays();
    await sale(at(d1, 11));
    const key = await setup(demandAgent);
    expect((await runAgent(key, { trigger: "schedule" }, deps(now))).proposalIds).toEqual([]);
  });

  test("when the restaurant is closed tomorrow there is nothing to plan", async () => {
    const { now, d1, d2, weekdayKey } = setupDays();
    for (const d of [d1, d2]) await sale(at(d, 11));
    const key = await setup(demandAgent);
    const closedTomorrow = { ...config, openingHours: { ...config.openingHours, [weekdayKey]: [] } };
    expect((await runAgent(key, { trigger: "schedule" }, deps(now, { config: closedTomorrow }))).proposalIds).toEqual([]);
  });

  test("runs once a day: asking again the same day adds nothing", async () => {
    const { now, d1, d2 } = setupDays();
    for (const d of [d1, d2]) await sale(at(d, 11));
    const key = await setup(demandAgent, "suggest_only");
    expect((await runAgent(key, { trigger: "schedule" }, deps(now))).proposalIds).toHaveLength(1);
    expect((await runAgent(key, { trigger: "manual" }, deps(new Date(now.getTime() + 3_600_000)))).proposalIds).toEqual([]);
  });

  test("approving a note only records that it was read", async () => {
    const { now, d1, d2 } = setupDays();
    for (const d of [d1, d2]) await sale(at(d, 11));
    const key = await setup(demandAgent, "approve_first");
    const r = await runAgent(key, { trigger: "schedule" }, deps(now));
    expect(await decideProposal((await makeUser("manager")).ctx, r.proposalIds[0], true, deps(now))).toBe("executed");
    expect((await proposals(key))[0].status).toBe("executed");
  });

  test("suggest-only notes can be dismissed but not approved", async () => {
    const { now, d1, d2 } = setupDays();
    for (const d of [d1, d2]) await sale(at(d, 11));
    const key = await setup(demandAgent, "suggest_only");
    const r = await runAgent(key, { trigger: "schedule" }, deps(now));
    expect((await proposals(key))[0].mode).toBe("advice");
    await expect(decideProposal((await makeUser("owner")).ctx, r.proposalIds[0], true, deps(now))).rejects.toThrow();
  });
});

describe("menu engineer", () => {
  async function menu(now: Date, quietDays = 60) {
    const created = new Date(now.getTime() - (quietDays + 100) * DAY);
    const cat = (await admin().query(`insert into menu_categories (slug, name) values ($1, 'Menu agent') returning id`, [`ma-${tag}-${++n}`])).rows[0].id;
    const item = async (name: string, over: { active?: boolean; available?: boolean; createdAt?: Date } = {}) =>
      (await admin().query(`insert into menu_items (category_id, slug, name, price_minor, active, available, created_at) values ($1, $2, $3, 100000, $4, $5, $6) returning id`, [cat, `${name}-${tag}-${++n}`.replace(/ /g, "-"), name, over.active ?? true, over.available ?? true, over.createdAt ?? created])).rows[0].id as string;
    return { item };
  }
  const busy = async (now: Date, itemId: string, count = 20) => {
    for (let i = 0; i < count; i++) await sale(new Date(now.getTime() - (5 + (i % 20)) * DAY), [{ itemId, name: "Popular", quantity: 1 }]);
  };

  test("suggests hiding a dish that has not sold, but not one that has", async () => {
    const now = new Date(Date.UTC(nextPast(), 5, 15, 12));
    const m = await menu(now);
    const popular = await m.item("Popular dish");
    const quiet = await m.item("Quiet dish");
    await busy(now, popular);
    const key = await setup(menuAgent, "approve_first");
    await runAgent(key, { trigger: "schedule" }, deps(now));
    const found = await proposals(key);
    expect(found.map((p) => p.payload.itemId)).toEqual([quiet]);
    expect(found[0]).toMatchObject({ kind: "menu.archive_item", customer_facing: false });
    expect(found[0].summary).toContain("Quiet dish");
  });

  test("never when the restaurant is quiet overall: a slow month does not hide the menu", async () => {
    const now = new Date(Date.UTC(nextPast(), 5, 15, 12));
    const m = await menu(now);
    const popular = await m.item("Popular dish");
    await m.item("Quiet dish");
    await busy(now, popular, 19);
    const key = await setup(menuAgent);
    expect((await runAgent(key, { trigger: "schedule" }, deps(now))).proposalIds).toEqual([]);
  });

  test("leaves out a dish that is already hidden, sold out, or too new to judge", async () => {
    const now = new Date(Date.UTC(nextPast(), 5, 15, 12));
    const m = await menu(now);
    await busy(now, await m.item("Popular dish"));
    await m.item("Hidden dish", { active: false });
    await m.item("Sold out dish", { available: false });
    await m.item("New dish", { createdAt: new Date(now.getTime() - 10 * DAY) });
    const key = await setup(menuAgent);
    expect((await runAgent(key, { trigger: "schedule" }, deps(now))).proposalIds).toEqual([]);
  });

  test("suggests at most the number set, oldest dishes first", async () => {
    const now = new Date(Date.UTC(nextPast(), 5, 15, 12));
    const m = await menu(now);
    await busy(now, await m.item("Popular dish"));
    const olds = [await m.item("Old A", { createdAt: new Date(now.getTime() - 400 * DAY) }), await m.item("Old B", { createdAt: new Date(now.getTime() - 390 * DAY) }), await m.item("Old C", { createdAt: new Date(now.getTime() - 380 * DAY) })];
    const key = await setup(menuAgent, "approve_first", { maxPerRun: 2 });
    await runAgent(key, { trigger: "schedule" }, deps(now));
    expect((await proposals(key)).map((p) => p.payload.itemId)).toEqual(olds.slice(0, 2));
  });

  test("approving hides the dish and records it; the dish is not suggested again for a while", async () => {
    const now = new Date(Date.UTC(nextPast(), 5, 15, 12));
    const m = await menu(now);
    await busy(now, await m.item("Popular dish"));
    const quiet = await m.item("Quiet dish");
    const key = await setup(menuAgent, "approve_first");
    const r = await runAgent(key, { trigger: "schedule" }, deps(now));
    expect(await decideProposal((await makeUser("manager")).ctx, r.proposalIds[0], true, deps(now))).toBe("executed");
    expect((await admin().query(`select active from menu_items where id = $1`, [quiet])).rows[0].active).toBe(false);
    expect((await admin().query(`select 1 from audit_log where action = 'menu.item.hidden_by_agent' and target_id = $1`, [quiet])).rowCount).toBe(1);
    await admin().query(`update menu_items set active = true where id = $1`, [quiet]); // someone shows it again
    expect((await runAgent(key, { trigger: "schedule" }, deps(new Date(now.getTime() + 30 * DAY)))).proposalIds).toEqual([]);
  });
});

describe("delivery watchdog", () => {
  async function delivery(now: Date, status: string, minutes: number, attempts = 0, orderStatus: "accepted" | "completed" = "accepted") {
    const c = await makeUser("customer");
    const { orderId } = await makeOrder(c.userId, orderStatus, "delivery");
    await admin().query(`insert into deliveries (order_id, provider, status, fee_charged_minor, attempts, updated_at) values ($1, 'mock', $2, 150000, $3, $4)`, [orderId, status, attempts, new Date(now.getTime() - minutes * 60_000)]);
    return { orderId, code: (await admin().query(`select public_code from orders where id = $1`, [orderId])).rows[0].public_code as string };
  }
  const alerts = async (code: string) => (await admin().query(`select kind, severity, payload from alerts where kind = 'delivery_stuck' and payload->>'orderCode' = $1`, [code])).rows;

  test("flags each kind of stuck delivery, and leaves alone the ones still within their time", async () => {
    const now = new Date(Date.UTC(nextEarly(), 5, 15, 12));
    const failing = await delivery(now, "queued", 30, 2);
    const noRider = await delivery(now, "pending", 70);
    const waiting = await delivery(now, "awaiting_pickup", 90);
    const road = await delivery(now, "in_transit", 130);
    const fine = [await delivery(now, "queued", 5, 1), await delivery(now, "pending", 10), await delivery(now, "in_transit", 40), await delivery(now, "queued", 500, 0)];
    const key = await setup(watchdogAgent, "approve_first");
    await runAgent(key, { trigger: "schedule" }, deps(now));
    const flagged = (await proposals(key)).map((p) => p.payload.orderCode).sort();
    expect(flagged).toEqual([failing.code, noRider.code, waiting.code, road.code].sort());
    for (const f of fine) expect(flagged).not.toContain(f.code);
  });

  test("an order that is no longer live is not watched", async () => {
    const now = new Date(Date.UTC(nextEarly(), 5, 15, 12));
    const done = await delivery(now, "in_transit", 999, 0, "completed");
    const key = await setup(watchdogAgent);
    await runAgent(key, { trigger: "schedule" }, deps(now));
    expect((await proposals(key)).map((p) => p.payload.orderCode)).not.toContain(done.code);
  });

  test("when it acts on its own it raises an alert for managers, with the order and the reason", async () => {
    const now = new Date(Date.UTC(nextEarly(), 5, 15, 12));
    const d = await delivery(now, "pending", 75);
    const key = await setup(watchdogAgent, "auto");
    await runAgent(key, { trigger: "schedule" }, deps(now));
    const [a] = await alerts(d.code);
    expect(a).toMatchObject({ kind: "delivery_stuck", severity: "warning" });
    expect(a.payload.detail).toContain("75 minutes");
  });

  test("it does not raise the same alert again and again: not within six hours, but again after", async () => {
    const now = new Date(Date.UTC(nextEarly(), 5, 15, 12));
    const d = await delivery(now, "pending", 75);
    const key = await setup(watchdogAgent, "auto");
    await runAgent(key, { trigger: "schedule" }, deps(now));
    await runAgent(key, { trigger: "schedule" }, deps(new Date(now.getTime() + 10 * 60_000)));
    await runAgent(key, { trigger: "schedule" }, deps(new Date(now.getTime() + 5 * 3_600_000)));
    expect(await alerts(d.code)).toHaveLength(1);
    await runAgent(key, { trigger: "schedule" }, deps(new Date(now.getTime() + 7 * 3_600_000)));
    expect(await alerts(d.code)).toHaveLength(2);
  });

  test("the thresholds are the agent's settings", async () => {
    const now = new Date(Date.UTC(nextEarly(), 5, 15, 12));
    const d = await delivery(now, "pending", 30);
    const key = await setup(watchdogAgent, "approve_first", { awaitingMinutes: 15 });
    await runAgent(key, { trigger: "schedule" }, deps(now));
    expect((await proposals(key)).map((p) => p.payload.orderCode)).toContain(d.code);
  });
});

describe("anomaly and abuse detector", () => {
  async function customerWith(now: Date, refunds: number, unpaid = 0) {
    const c = await makeUser("customer");
    await admin().query(`update profiles set full_name = $2 where id = $1`, [c.userId, `Anom ${c.userId.slice(0, 6)}`]);
    for (let i = 0; i < refunds; i++) await sale(new Date(now.getTime() - (2 + i) * DAY), [], "refunded", c.userId);
    for (let i = 0; i < unpaid; i++) {
      const { orderId } = await makeOrder(c.userId, "cancelled");
      await admin().query(`insert into order_events (order_id, from_status, to_status, actor_type, created_at) values ($1, 'placed', 'cancelled', 'system', $2)`, [orderId, new Date(now.getTime() - (i + 1) * 3_600_000)]);
    }
    return c;
  }
  const ids = async (key: string) => (await proposals(key)).map((p) => p.payload.profileId);

  test("proposes reviewing a customer with repeated refunds, with the evidence, and treats it as customer-facing", async () => {
    const now = new Date(Date.UTC(nextFuture(), 5, 15, 12));
    const c = await customerWith(now, 3);
    const key = await setup(anomalyAgent, "approve_first");
    await runAgent(key, { trigger: "schedule" }, deps(now));
    const [p] = (await proposals(key)).filter((x) => x.payload.profileId === c.userId);
    expect(p).toMatchObject({ kind: "customer.block", customer_facing: true, mode: "approve" });
    expect(p.summary).toContain("3 of their orders were refunded in the last 30 days");
  });

  test("and one who lets many orders expire unpaid in a day", async () => {
    const now = new Date(Date.UTC(nextFuture(), 5, 15, 12));
    const c = await customerWith(now, 0, 5);
    const key = await setup(anomalyAgent, "approve_first");
    await runAgent(key, { trigger: "schedule" }, deps(now));
    expect(await ids(key)).toContain(c.userId);
  });

  test("not on a single refund or a couple of expired orders", async () => {
    const now = new Date(Date.UTC(nextFuture(), 5, 15, 12));
    const a = await customerWith(now, 2);
    const b = await customerWith(now, 0, 4);
    const key = await setup(anomalyAgent, "approve_first");
    await runAgent(key, { trigger: "schedule" }, deps(now));
    const found = await ids(key);
    expect(found).not.toContain(a.userId);
    expect(found).not.toContain(b.userId);
  });

  test("never a customer who is already blocked, or someone who is not a customer", async () => {
    const now = new Date(Date.UTC(nextFuture(), 5, 15, 12));
    const blocked = await customerWith(now, 3);
    await admin().query(`update profiles set blocked_at = now() where id = $1`, [blocked.userId]);
    const staff = await customerWith(now, 3);
    await admin().query(`update profiles set role = 'manager' where id = $1`, [staff.userId]);
    const key = await setup(anomalyAgent, "approve_first");
    await runAgent(key, { trigger: "schedule" }, deps(now));
    const found = await ids(key);
    expect(found).not.toContain(blocked.userId);
    expect(found).not.toContain(staff.userId);
  });

  test("the same customer is not proposed again for a week", async () => {
    const now = new Date(Date.UTC(nextFuture(), 5, 15, 12));
    const c = await customerWith(now, 3);
    const key = await setup(anomalyAgent, "approve_first");
    await runAgent(key, { trigger: "schedule" }, deps(now));
    await admin().query(`update agent_proposals set status = 'rejected' where agent_key = $1`, [key]);
    expect((await runAgent(key, { trigger: "schedule" }, deps(new Date(now.getTime() + 3 * DAY)))).proposalIds.length).toBe(0);
    expect(await ids(key)).toEqual([c.userId]); // only the first proposal exists
  });

  test("approving blocks the customer and records who decided; a customer-facing action waits even in auto until confirmed", async () => {
    const now = new Date(Date.UTC(nextFuture(), 5, 15, 12));
    const c = await customerWith(now, 3);
    const key = await setup(anomalyAgent, "auto");
    const r = await runAgent(key, { trigger: "schedule" }, deps(now));
    expect((await proposals(key))[0]).toMatchObject({ mode: "approve", status: "pending" }); // auto, but not confirmed by an owner
    expect((await admin().query(`select blocked_at from profiles where id = $1`, [c.userId])).rows[0].blocked_at).toBeNull();
    expect(await decideProposal((await makeUser("manager")).ctx, r.proposalIds[0], true, deps(now))).toBe("executed");
    expect((await admin().query(`select blocked_at from profiles where id = $1`, [c.userId])).rows[0].blocked_at).toBeTruthy();
    expect((await admin().query(`select actor_role, meta from audit_log where action = 'profile.block' and target_id = $1`, [c.userId])).rows[0]).toMatchObject({ actor_role: "system", meta: { by: "agent" } });
  });

  test("if the customer was blocked or changed meanwhile, approving fails with a reason and changes nothing", async () => {
    const now = new Date(Date.UTC(nextFuture(), 5, 15, 12));
    const c = await customerWith(now, 3);
    const key = await setup(anomalyAgent, "approve_first");
    const r = await runAgent(key, { trigger: "schedule" }, deps(now));
    await admin().query(`update profiles set blocked_at = now() where id = $1`, [c.userId]);
    expect(await decideProposal((await makeUser("owner")).ctx, r.proposalIds[0], true, deps(now))).toBe("failed");
    expect((await proposals(key))[0].error).toContain("Not blocked");
  });
});
