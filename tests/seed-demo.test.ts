import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { restaurantConfig } from "../config/restaurant";
import { DemoSeedError, seedDemo } from "../db/seed/demo";
import { seedMenu } from "../db/seed/menu";
import { closePools } from "../src/db/context";
import { localDay } from "../src/domain/time";
import { startTestDb, type TestDb } from "./helpers/db";

// Its own database: seed:demo refuses to run where real orders exist, and the shared test database is full of them.
let db: TestDb;
let pool: Pool;
const NOW = new Date("2031-03-12T11:00:00Z");
const demoConfig = { ...restaurantConfig, features: { ...restaurantConfig.features, demo_mode: true } };
const run = (over: Partial<Parameters<typeof seedDemo>[0]> = {}) => seedDemo({ db: drizzle(pool), config: demoConfig, now: NOW, ...over });
const q = async <T = Record<string, unknown>>(text: string, values: unknown[] = []) => (await pool.query(text, values)).rows as T[];
const n = async (text: string, values: unknown[] = []) => Number((await q<{ n: string }>(text, values))[0].n);

beforeAll(async () => {
  db = await startTestDb();
  pool = new Pool({ connectionString: db.urls.admin, max: 2 });
  await seedMenu({ url: db.urls.system });
});
afterAll(async () => {
  await pool.end();
  await closePools();
  await db.stop();
});

describe("seed:demo refuses", () => {
  test("when demo mode is off", async () => {
    await expect(seedDemo({ db: drizzle(pool), config: restaurantConfig, now: NOW })).rejects.toThrow(DemoSeedError);
    await expect(seedDemo({ db: drizzle(pool), config: restaurantConfig, now: NOW })).rejects.toThrow(/demo_mode/);
    expect(await n(`select count(*) as n from "user" where email like '%@demo.invalid'`)).toBe(0);
  });

  test("when the database holds a real order, and leaves everything as it was", async () => {
    const id = randomUUID();
    await pool.query(`insert into "user" (id, name, email) values ($1, 'Real Person', 'real@example.com')`, [id]);
    await pool.query(`insert into profiles (id, role, full_name) values ($1, 'customer', 'Real Person')`, [id]);
    await pool.query(
      `insert into orders (public_code, profile_id, customer_name, status, fulfilment, subtotal_minor, total_minor, currency) values ('REAL01', $1, 'Real Person', 'placed', 'pickup', 100000, 100000, 'NGN')`,
      [id],
    );
    await expect(run()).rejects.toThrow(/real orders/);
    expect(await n(`select count(*) as n from "user" where email like '%@demo.invalid'`)).toBe(0);
    await pool.query(`delete from orders where public_code = 'REAL01'`);
    await pool.query(`delete from "user" where id = $1`, [id]);
  });

  test("when an order has no customer, because that is what a deleted real account leaves behind", async () => {
    await pool.query(`insert into orders (public_code, profile_id, customer_name, status, fulfilment, subtotal_minor, total_minor, currency) values ('GONE01', null, 'Deleted', 'completed', 'pickup', 100000, 100000, 'NGN')`);
    await expect(run()).rejects.toThrow(/real orders/);
    await pool.query(`delete from orders where public_code = 'GONE01'`);
  });
});

describe("seed:demo", () => {
  let first: Awaited<ReturnType<typeof seedDemo>>;
  beforeAll(async () => {
    first = await run();
  });

  test("makes fictional customers, all on a reserved address nobody can receive mail at", async () => {
    expect(first.customers).toBeGreaterThanOrEqual(8);
    const rows = await q<{ email: string; role: string }>(`select u.email, p.role from "user" u join profiles p on p.id = u.id`);
    expect(rows).toHaveLength(first.customers);
    for (const r of rows) {
      expect(r.email).toMatch(/@demo\.invalid$/);
      expect(r.role).toBe("customer");
    }
  });

  test("a demo customer cannot sign in: there is no password for them", async () => {
    expect(await n(`select count(*) as n from account`)).toBe(0);
  });

  test("every customer agreed to the terms and privacy policy, as a real signup records", async () => {
    const missing = await n(`select count(*) as n from profiles p where not exists (select 1 from consents c where c.profile_id = p.id and c.type = 'terms') or not exists (select 1 from consents c where c.profile_id = p.id and c.type = 'privacy')`);
    expect(missing).toBe(0);
  });

  test("two weeks of orders, none in the future and none on a day the restaurant is closed", async () => {
    expect(first.orders).toBeGreaterThan(40);
    expect(await n(`select count(*) as n from orders`)).toBe(first.orders);
    expect(await n(`select count(*) as n from orders where placed_at > $1 or placed_at < $2`, [NOW.toISOString(), new Date(NOW.getTime() - 15 * 86_400_000).toISOString()])).toBe(0);
    const days = await q<{ placed_at: Date }>(`select placed_at from orders`);
    for (const d of days) {
      const day = localDay(d.placed_at.getTime(), restaurantConfig.timezone);
      expect(restaurantConfig.openingHours[day.weekday].length, String(d.placed_at)).toBeGreaterThan(0);
    }
  });

  test("the money adds up: lines sum to the subtotal, and the total is what was paid", async () => {
    const extra = demoConfig.charges.pricesIncludeCharges ? "0" : "o.service_charge_minor + o.tax_minor";
    const bad = await n(`select count(*) as n from orders o where o.subtotal_minor <> (select coalesce(sum(line_total_minor), 0) from order_items i where i.order_id = o.id) or o.total_minor <> o.subtotal_minor - o.discount_minor + ${extra} + o.delivery_fee_minor`);
    expect(bad).toBe(0);
    const mismatch = await n(`select count(*) as n from payments p join orders o on o.id = p.order_id where p.amount_minor <> o.total_minor`);
    expect(mismatch).toBe(0);
  });

  test("each order's status agrees with its payment and its history", async () => {
    const paidStatuses = `('paid','accepted','preparing','ready','picked_up','completed')`;
    expect(await n(`select count(*) as n from orders o where o.status in ${paidStatuses} and not exists (select 1 from payments p where p.order_id = o.id and p.status = 'succeeded' and p.paid_at is not null)`)).toBe(0);
    expect(await n(`select count(*) as n from orders o where o.status = 'cancelled' and exists (select 1 from payments p where p.order_id = o.id)`)).toBe(0);
    expect(await n(`select count(*) as n from orders o where o.status = 'refunded' and not exists (select 1 from payments p join refunds r on r.payment_id = p.id where p.order_id = o.id and p.status = 'refunded' and r.status = 'succeeded')`)).toBe(0);
    // The last logged event is the order's status.
    expect(await n(`select count(*) as n from orders o where (select to_status::text from order_events e where e.order_id = o.id order by e.created_at desc, e.id desc limit 1) <> o.status::text`)).toBe(0);
  });

  test("there is a believable mix: mostly finished orders, a few cancelled, a refund or two", async () => {
    const mix = Object.fromEntries((await q<{ status: string; c: string }>(`select status, count(*) as c from orders group by 1`)).map((r) => [r.status, Number(r.c)]));
    expect(mix.completed).toBeGreaterThan(first.orders / 2);
    expect(mix.cancelled).toBeGreaterThanOrEqual(1);
    expect(mix.refunded).toBeGreaterThanOrEqual(1);
  });

  test("the history is only ever finished: nothing left waiting in the kitchen, for the live stream to handle", async () => {
    expect(await n(`select count(*) as n from orders where status in ('placed','paid','accepted','preparing','ready','out_for_delivery','delivery_failed')`)).toBe(0);
  });

  test("a promo and a QR code exist, and orders are attributed to them", async () => {
    expect(await n(`select count(*) as n from promos where code = 'DEMO10'`)).toBe(1);
    expect(await n(`select count(*) as n from qr_sources where label like 'Demo%'`)).toBe(1);
    expect(await n(`select count(*) as n from orders where source_id is not null`)).toBeGreaterThan(0);
    expect(await n(`select count(*) as n from qr_scans`)).toBeGreaterThan(0);
  });

  test("running it again gives the same picture, not a doubled one", async () => {
    const before = { users: await n(`select count(*) as n from "user"`), orders: await n(`select count(*) as n from orders`), payments: await n(`select count(*) as n from payments`), promos: await n(`select count(*) as n from promos where code = 'DEMO10'`) };
    const again = await run();
    expect(again.orders).toBe(first.orders);
    expect(again.removedOrders).toBe(first.orders);
    expect({ users: await n(`select count(*) as n from "user"`), orders: await n(`select count(*) as n from orders`), payments: await n(`select count(*) as n from payments`), promos: await n(`select count(*) as n from promos where code = 'DEMO10'`) }).toEqual(before);
  });

  test("it leaves other people's data alone", async () => {
    const id = randomUUID();
    await pool.query(`insert into "user" (id, name, email) values ($1, 'Owner', 'owner@example.com')`, [id]);
    await pool.query(`insert into profiles (id, role, full_name) values ($1, 'owner', 'Owner')`, [id]);
    await run();
    expect(await n(`select count(*) as n from profiles where id = $1`, [id])).toBe(1);
    expect(await n(`select count(*) as n from menu_items`)).toBeGreaterThan(0);
    await pool.query(`delete from "user" where id = $1`, [id]);
  });

  test("an empty menu is a clear error, not an empty demo", async () => {
    await pool.query(`update menu_items set active = false`);
    await expect(run()).rejects.toThrow(/menu/i);
    await pool.query(`update menu_items set active = true`);
  });
});
