import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, test } from "vitest";
import { restaurantConfig } from "../config/restaurant";
import type { RestaurantConfig } from "../config/schema";
import { seedMenu } from "../db/seed/menu";
import { closePools } from "../src/db/context";
import { queueDeliveries, dispatchQueued } from "../src/delivery/dispatch";
import { syncDeliveries } from "../src/delivery/sync";
import { runDemoStream } from "../src/jobs/demo-stream";
import type { PaymentProvider } from "../src/providers/payment/types";
import { MockDeliveryProvider } from "../src/providers/delivery/mock";
import { MockPaymentProvider } from "../src/providers/payment/mock";
import { admin, closeFixtures, makeOrder, makeUser } from "./helpers/fixtures";

const urls = inject("dbUrls");
const cfg: RestaurantConfig = { ...restaurantConfig, features: { ...restaurantConfig.features, demo_mode: true } };
const cfgDelivery: RestaurantConfig = { ...cfg, features: { ...cfg.features, delivery: true } };

// A Tuesday at noon in Lagos, years from now so nothing else's clock is near it. Tuesdays are open 10:00 to 21:00.
const tuesday = (() => {
  const d = new Date("2037-03-02T11:00:00Z");
  while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() + 1);
  return d;
})();
const sunday = new Date(tuesday.getTime() + 5 * 86_400_000);

const payment = new MockPaymentProvider("NGN");
const delivery = new MockDeliveryProvider();
const run = (over: Parameters<typeof runDemoStream>[0] = {}) =>
  runDemoStream({ config: cfg, now: tuesday, appUrl: urls.app, systemUrl: urls.system, baseUrl: "http://localhost:3000", payment, delivery, rng: () => 0.2, placeChance: 0, advanceChance: 0, abandonChance: 0, deliveryShare: 0, ...over });

const q = async <T = Record<string, unknown>>(text: string, values: unknown[] = []) => (await admin().query(text, values)).rows as T[];
async function demoCustomer(): Promise<{ id: string; email: string }> {
  const id = randomUUID();
  const email = `stream.${id}@demo.invalid`;
  await admin().query(`insert into "user" (id, name, email) values ($1, 'Demo Person', $2)`, [id, email]);
  await admin().query(`insert into profiles (id, role, full_name, phone) values ($1, 'customer', 'Demo Person', '+234 800 000 0099')`, [id]);
  return { id, email };
}
const demoCustomers = `select p.id from profiles p join "user" u on u.id = p.id where u.email like '%@demo.invalid' and p.role = 'customer'`;
/** Blocks every demo customer except `keep`, so the stream can only pick that one. */
const blockOthers = (keep?: string) => admin().query(`update profiles set blocked_at = now() where id in (${demoCustomers}${keep ? " and p.id <> $1" : ""})`, keep ? [keep] : []);
const unblockAll = () => admin().query(`update profiles set blocked_at = null where id in (${demoCustomers})`);
const statusOf = async (id: string) => (await q<{ status: string }>(`select status from orders where id = $1`, [id]))[0].status;
async function latestOrderOf(profileId: string) {
  return (await q<{ id: string; public_code: string; status: string; fulfilment: string }>(`select id, public_code, status, fulfilment from orders where profile_id = $1 order by placed_at desc limit 1`, [profileId]))[0];
}

beforeAll(async () => {
  await seedMenu({ url: urls.system });
});
afterAll(async () => {
  await closePools();
  await closeFixtures();
});

describe("the live demo stream refuses", () => {
  test("to do anything when demo mode is off", async () => {
    const r = await run({ config: restaurantConfig, placeChance: 1 });
    expect(r).toMatchObject({ placed: 0, advanced: 0, riders: 0, skipped: "demo_mode_off" });
  });

  test("to run against a real payment provider, whatever the config says", async () => {
    const real = { ...payment, name: "paystack" } as unknown as PaymentProvider;
    await expect(run({ payment: real })).rejects.toThrow(/real/i);
  });
});

describe("the live demo stream, with nobody to order", () => {
  test("places nothing, and says why", async () => {
    expect(await run({ placeChance: 1 })).toMatchObject({ placed: 0, skipped: "no_customers" });
  });
});

describe("the live demo stream", () => {
  test("while the restaurant is closed, places nothing, because a real customer could not either", async () => {
    await demoCustomer();
    expect(await run({ now: sunday, placeChance: 1 })).toMatchObject({ placed: 0, skipped: "closed" });
  });

  test("places an order as a demo customer, through the real checkout, and pays it through the mock", async () => {
    const c = await demoCustomer();
    const r = await run({ placeChance: 1 });
    expect(r.placed).toBe(1);
    const order = (await q<{ id: string; profile_id: string; status: string }>(`select o.id, o.profile_id, o.status from orders o join "user" u on u.id = o.profile_id where u.email like '%@demo.invalid' order by o.placed_at desc limit 1`))[0];
    expect(order.status).toBe("paid");
    const pay = await q<{ provider: string; status: string; amount_minor: string }>(`select provider, status, amount_minor from payments where order_id = $1`, [order.id]);
    expect(pay).toHaveLength(1);
    expect(pay[0]).toMatchObject({ provider: "mock", status: "succeeded" });
    const events = await q<{ from_status: string | null; to_status: string; actor_type: string }>(`select from_status, to_status, actor_type from order_events where order_id = $1 order by created_at, id`, [order.id]);
    // A real order logs only its transitions: the webhook, not the customer, moves it to paid.
    expect(events.map((e) => e.to_status)).toEqual(["paid"]);
    expect(events.map((e) => e.actor_type)).toEqual(["system"]);
    expect(c.id).toBeTruthy();
  });

  test("a customer sometimes walks away without paying, and the order is left for the expiry job", async () => {
    const c = await demoCustomer();
    const r = await run({ placeChance: 1, abandonChance: 1 });
    expect(r.placed).toBe(1);
    const o = (await q<{ id: string; status: string }>(`select o.id, o.status from orders o join "user" u on u.id = o.profile_id where u.email like '%@demo.invalid' order by o.placed_at desc, o.id desc limit 1`))[0];
    expect(o.status).toBe("placed");
    expect(await q(`select 1 from payments where order_id = $1 and status = 'succeeded'`, [o.id])).toHaveLength(0);
    expect(c.id).toBeTruthy();
  });

  test("never has more orders in flight than the limit", async () => {
    await demoCustomer();
    expect((await run({ placeChance: 1, maxLive: 0 })).placed).toBe(0);
  });

  test("a pickup order moves one step a tick, by the demo kitchen, and ends completed", async () => {
    const c = await demoCustomer();
    // Make this customer the only one the stream can pick, by making every other demo customer's profile blocked for now.
    await blockOthers(c.id);
    try {
      await run({ placeChance: 1 });
      const mine = await latestOrderOf(c.id);
      expect(mine.status).toBe("paid");
      const seen: string[] = [];
      for (let i = 0; i < 7; i++) {
        await run({ advanceChance: 1 });
        seen.push(await statusOf(mine.id));
      }
      expect(seen).toEqual(["accepted", "preparing", "ready", "picked_up", "completed", "completed", "completed"]);

      const events = await q<{ to_status: string; actor_type: string; actor_id: string | null }>(`select to_status, actor_type, actor_id from order_events where order_id = $1 order by created_at, id`, [mine.id]);
      const staff = events.filter((e) => e.actor_type === "staff");
      expect(staff.map((e) => e.to_status)).toEqual(["accepted", "preparing", "ready", "picked_up"]);
      expect(new Set(staff.map((e) => e.actor_id)).size).toBe(1);
      const kitchen = await q<{ id: string; role: string; email: string }>(`select p.id, p.role, u.email from profiles p join "user" u on u.id = p.id where u.email = 'demo.kitchen@demo.invalid'`);
      expect(kitchen).toHaveLength(1);
      expect(kitchen[0].role).toBe("kitchen");
      expect(staff[0].actor_id).toBe(kitchen[0].id);
      expect(events.at(-1)).toMatchObject({ to_status: "completed", actor_type: "system" });
    } finally {
      await unblockAll();
    }
  });

  test("a customer who is blocked is never picked to order", async () => {
    const only = await demoCustomer();
    await blockOthers();
    try {
      expect(await run({ placeChance: 1 })).toMatchObject({ placed: 0, skipped: "no_customers" });
    } finally {
      await unblockAll();
    }
    expect(only.id).toBeTruthy();
  });

  test("only demo orders are ever moved: a real customer's order is left exactly as it was", async () => {
    const real = await makeUser("customer");
    const { orderId } = await makeOrder(real.userId, "paid");
    await run({ advanceChance: 1 });
    await run({ advanceChance: 1 });
    expect(await statusOf(orderId)).toBe("paid");
  });

  test("an order someone moved by hand in the meantime does not break the tick", async () => {
    const c = await demoCustomer();
    await blockOthers(c.id);
    try {
      await run({ placeChance: 1 });
      const mine = await latestOrderOf(c.id);
      // A visitor trying the kitchen screen gets there first.
      await admin().query(`update orders set status = 'accepted' where id = $1`, [mine.id]);
      await admin().query(`update orders set status = 'preparing' where id = $1`, [mine.id]);
      await expect(run({ advanceChance: 1 })).resolves.toBeDefined();
      expect(["ready", "preparing"]).toContain(await statusOf(mine.id));
    } finally {
      await unblockAll();
    }
  });
});

describe("the live demo stream with delivery on", () => {
  test("a delivery order goes through the real dispatch, a mock rider and the sync job, to completed", async () => {
    const c = await demoCustomer();
    await blockOthers(c.id);
    try {
      const r = await run({ config: cfgDelivery, placeChance: 1, deliveryShare: 1 });
      expect(r.placed).toBe(1);
      const mine = await latestOrderOf(c.id);
      expect(mine.fulfilment).toBe("delivery");

      let done = false;
      for (let i = 0; i < 40 && !done; i++) {
        await run({ config: cfgDelivery, advanceChance: 1 });
        await queueDeliveries({ config: cfgDelivery, provider: delivery, systemUrl: urls.system, onlyOrderIds: [mine.id] });
        await dispatchQueued({ config: cfgDelivery, provider: delivery, systemUrl: urls.system, now: tuesday, onlyOrderIds: [mine.id] });
        await syncDeliveries({ provider: delivery, systemUrl: urls.system, onlyOrderIds: [mine.id] });
        done = (await statusOf(mine.id)) === "completed";
      }
      expect(done).toBe(true);
      const d = await q<{ status: string; provider: string }>(`select status, provider from deliveries where order_id = $1`, [mine.id]);
      expect(d).toHaveLength(1);
      expect(d[0]).toMatchObject({ status: "delivered", provider: "mock" });
    } finally {
      await unblockAll();
    }
  });
});
