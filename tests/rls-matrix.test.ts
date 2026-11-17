import { randomBytes } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, test } from "vitest";
import { closePools, withRequestContext, withSystemContext, type RequestContext } from "../src/db/context";
import { admin, closeFixtures, makeOrder, makeUser } from "./helpers/fixtures";

const urls = inject("dbUrls");
const opts = { url: urls.app };
const sysOpts = { url: urls.system };

type U = { userId: string; ctx: RequestContext };
let custA: U, custB: U, kitchen: U, manager: U, owner: U;
let orderA1: string, orderA2: string, orderB: string;
let catActive: string, catInactive: string;

const as = <T>(u: U | RequestContext, fn: (tx: Parameters<Parameters<typeof withRequestContext>[1]>[0]) => Promise<T>) =>
  withRequestContext("ctx" in u ? u.ctx : u, fn, opts);

/** Runs one statement as a user. Resolves to the row count, or to the error text when the database refuses it. */
async function attempt(u: U, query: SQL): Promise<number | string> {
  try {
    const r = await as(u, (tx) => tx.execute(query));
    return r.rowCount ?? r.rows.length;
  } catch (e) {
    const err = e as { cause?: { message?: string }; message: string };
    return err.cause?.message ?? err.message;
  }
}
const denied = /permission denied|row-level security|violates|not allowed|only an owner|cannot/i;

const idList = (ids: string[]) => sql.raw(ids.map((i) => `'${i}'`).join(","));
const count = async (u: U, table: string, idCol: string, ids: string[]) => {
  const r = await as(u, (tx) => tx.execute(sql`select count(*)::int as n from ${sql.raw(table)} where ${sql.raw(idCol)} in (${idList(ids)})`));
  return r.rows[0].n as number;
};

beforeAll(async () => {
  [custA, custB, kitchen, manager, owner] = await Promise.all([
    makeUser("customer"),
    makeUser("customer"),
    makeUser("kitchen"),
    makeUser("manager"),
    makeUser("owner"),
  ]);
  orderA1 = (await makeOrder(custA.userId, "paid")).orderId;
  orderA2 = (await makeOrder(custA.userId, "completed")).orderId;
  orderB = (await makeOrder(custB.userId, "placed")).orderId;
  for (const o of [orderA1, orderA2, orderB]) {
    await admin().query(`insert into order_contacts (order_id, phone, address_snapshot) values ($1, '0800', '{}')`, [o]);
    await admin().query(
      `insert into order_items (order_id, name_snapshot, unit_price_minor_snapshot, quantity, line_total_minor) values ($1, 'Jollof', 100000, 1, 100000)`,
      [o],
    );
  }
  await admin().query(
    `insert into payments (order_id, provider, reference, amount_minor, currency) values ($1, 'mock', $2, 100000, 'NGN')`,
    [orderA1, `ref-${randomBytes(4).toString("hex")}`],
  );
  catActive = (await admin().query(`insert into menu_categories (slug, name, active) values ($1, 'On', true) returning id`, [`on-${randomBytes(3).toString("hex")}`])).rows[0].id;
  catInactive = (await admin().query(`insert into menu_categories (slug, name, active) values ($1, 'Off', false) returning id`, [`off-${randomBytes(3).toString("hex")}`])).rows[0].id;
  await admin().query(`insert into menu_items (category_id, slug, name, price_minor, active) values ($1, $2, 'Seen', 100, true), ($1, $3, 'Hidden', 100, false)`, [
    catActive,
    `seen-${catActive}`,
    `hidden-${catActive}`,
  ]);
  await admin().query(`insert into webhook_events (provider, event_id, event_type, payload) values ('mock', $1, 'x', '{}')`, [`evt-${orderA1}`]);
  await admin().query(`insert into audit_log (actor_role, action) values ('system', $1)`, [`seed-${orderA1}`]);
});

afterAll(async () => {
  await closePools();
  await closeFixtures();
});

describe("reading", () => {
  test("customer sees only their own orders and contacts", async () => {
    const mine = [orderA1, orderA2];
    const all = [orderA1, orderA2, orderB];
    expect(await count(custA, "orders", "id", all)).toBe(2);
    expect(await count(custB, "orders", "id", all)).toBe(1);
    expect(await count(custA, "order_contacts", "order_id", all)).toBe(2);
    expect(await count(custA, "order_items", "order_id", all)).toBe(mine.length);
  });

  test("kitchen sees active orders and items but zero order_contacts rows", async () => {
    const all = [orderA1, orderA2, orderB];
    expect(await count(kitchen, "orders", "id", all)).toBe(1); // only the paid one
    expect(await count(kitchen, "order_items", "order_id", all)).toBe(1);
    expect(await count(kitchen, "order_contacts", "order_id", all)).toBe(0);
    expect(await count(kitchen, "payments", "order_id", all)).toBe(0);
  });

  test("manager and owner read everything operational", async () => {
    const all = [orderA1, orderA2, orderB];
    for (const u of [manager, owner]) {
      expect(await count(u, "orders", "id", all)).toBe(3);
      expect(await count(u, "order_contacts", "order_id", all)).toBe(3);
      expect(await count(u, "payments", "order_id", all)).toBe(1);
    }
  });

  test("a customer sees their own payment and nobody else's", async () => {
    const all = [orderA1, orderA2, orderB];
    expect(await count(custA, "payments", "order_id", all)).toBe(1);
    expect(await count(custB, "payments", "order_id", all)).toBe(0);
  });

  test("profiles: customers and kitchen see only themselves, manager and owner see all", async () => {
    const ids = [custA, custB, kitchen, manager, owner].map((u) => u.userId);
    expect(await count(custA, "profiles", "id", ids)).toBe(1);
    expect(await count(kitchen, "profiles", "id", ids)).toBe(1);
    expect(await count(manager, "profiles", "id", ids)).toBe(5);
    expect(await count(owner, "profiles", "id", ids)).toBe(5);
  });

  test("customers see only active menu rows, staff see all", async () => {
    const cats = [catActive, catInactive];
    expect(await count(custA, "menu_categories", "id", cats)).toBe(1);
    for (const u of [kitchen, manager, owner]) expect(await count(u, "menu_categories", "id", cats)).toBe(2);
    const items = await as(custA, (tx) => tx.execute(sql`select slug from menu_items where category_id = ${catActive}::uuid`));
    expect(items.rows.map((r) => r.slug)).toEqual([`seen-${catActive}`]);
  });

  test("no app role can read webhook_events, and only the owner reads audit_log", async () => {
    for (const u of [custA, kitchen, manager, owner]) {
      const r = await attempt(u, sql`select * from webhook_events`);
      expect(typeof r === "string" ? r : r === 0).toBeTruthy();
    }
    const read = async (u: U) => attempt(u, sql`select * from audit_log where action = ${`seed-${orderA1}`}`);
    expect(await read(owner)).toBe(1);
    for (const u of [custA, kitchen, manager]) expect(await read(u)).toBe(0);
  });

  test("a connection with no context reads nothing from any application table", async () => {
    const c = new Client({ connectionString: urls.app });
    await c.connect();
    try {
      for (const t of ["profiles", "orders", "order_contacts", "order_items", "payments", "audit_log", "addresses", "consents"]) {
        const r = await c.query(`select count(*)::int as n from ${t}`).then((x) => x.rows[0].n as number, () => 0);
        expect(r, t).toBe(0);
      }
      // The one deliberate exception: visitors browse the menu before signing in, so active rows are public.
      const menu = await c.query(`select active from menu_categories where id in ('${catActive}', '${catInactive}')`);
      expect(menu.rows).toEqual([{ active: true }]);
    } finally {
      await c.end();
    }
  });
});

describe("writing", () => {
  const newOrder = (profile: string, status: string, code = randomBytes(4).toString("hex")) =>
    sql`insert into orders (public_code, profile_id, customer_name, status, fulfilment, subtotal_minor, total_minor, currency)
        values (${code}, ${profile}::uuid, 'X', ${status}::order_status, 'pickup', 100, 100, 'NGN')`;

  test("customer can insert an order only for themselves with status placed", async () => {
    expect(await attempt(custA, newOrder(custA.userId, "placed"))).toBe(1);
    expect(await attempt(custA, newOrder(custB.userId, "placed"))).toMatch(denied);
    expect(await attempt(custA, newOrder(custA.userId, "paid"))).toMatch(denied);
    expect(await attempt(kitchen, newOrder(kitchen.userId, "placed"))).toMatch(denied);
  });

  test("no app role can update orders, including orders.status", async () => {
    for (const u of [custA, kitchen, manager, owner]) {
      const r = await attempt(u, sql`update orders set status = 'accepted' where id = ${orderA1}::uuid`);
      expect(r, u.ctx.role).toMatch(denied);
      const r2 = await attempt(u, sql`update orders set notes = 'x' where id = ${orderA1}::uuid`);
      expect(r2, u.ctx.role).toMatch(denied);
    }
  });

  test("manager and owner can write menu rows, customer and kitchen cannot", async () => {
    const add = (n: string) => sql`insert into menu_items (category_id, slug, name, price_minor) values (${catActive}::uuid, ${n}, 'N', 100)`;
    expect(await attempt(manager, add(`m-${catActive}`))).toBe(1);
    expect(await attempt(owner, add(`o-${catActive}`))).toBe(1);
    expect(await attempt(custA, add(`c-${catActive}`))).toMatch(denied);
    expect(await attempt(kitchen, add(`k-${catActive}`))).toMatch(denied);
  });

  test("customer can update their own name but not their role or blocked state, or anyone else's profile", async () => {
    expect(await attempt(custA, sql`update profiles set full_name = 'Renamed' where id = ${custA.userId}::uuid`)).toBe(1);
    expect(await attempt(custA, sql`update profiles set role = 'owner' where id = ${custA.userId}::uuid`)).toMatch(denied);
    expect(await attempt(custA, sql`update profiles set blocked_at = now() where id = ${custA.userId}::uuid`)).toMatch(denied);
    expect(await attempt(custA, sql`update profiles set full_name = 'Hacked' where id = ${custB.userId}::uuid`)).toBe(0);
  });

  test("manager cannot change a role directly or through the function; only an owner can, and not their own", async () => {
    expect(await attempt(manager, sql`update profiles set role = 'owner' where id = ${custB.userId}::uuid`)).toMatch(denied);
    expect(await attempt(manager, sql`select set_profile_role(${custB.userId}::uuid, 'manager'::app_role)`)).toMatch(denied);
    expect(await attempt(owner, sql`select set_profile_role(${custB.userId}::uuid, 'kitchen'::app_role)`)).toBe(1);
    const role = await admin().query(`select role from profiles where id = $1`, [custB.userId]);
    expect(role.rows[0].role).toBe("kitchen");
    await admin().query(`update profiles set role = 'customer' where id = $1`, [custB.userId]);
    expect(await attempt(owner, sql`select set_profile_role(${owner.userId}::uuid, 'customer'::app_role)`)).toMatch(denied);
  });

  test("blocking: a manager can block a customer, not an owner; an owner can block a manager; a customer cannot block", async () => {
    expect(await attempt(manager, sql`select block_profile(${custA.userId}::uuid, true)`)).toBe(1);
    expect(await attempt(manager, sql`select block_profile(${owner.userId}::uuid, true)`)).toMatch(denied);
    expect(await attempt(custB, sql`select block_profile(${custA.userId}::uuid, false)`)).toMatch(denied);
    expect(await attempt(owner, sql`select block_profile(${manager.userId}::uuid, true)`)).toBe(1);
    expect(await attempt(owner, sql`select block_profile(${manager.userId}::uuid, false)`)).toBe(1);
    expect(await attempt(manager, sql`select block_profile(${custA.userId}::uuid, false)`)).toBe(1);
    const audit = await admin().query(`select count(*)::int as n from audit_log where action = 'profile.block' and target_id = $1`, [custA.userId]);
    expect(audit.rows[0].n).toBeGreaterThanOrEqual(1);
  });

  test("audit_log: staff can add their own entries, cannot forge another actor, and nobody can edit or delete", async () => {
    const add = (actor: string, role: string) => sql`insert into audit_log (actor_id, actor_role, action) values (${actor}::uuid, ${role}, 'test.entry')`;
    expect(await attempt(manager, add(manager.userId, "manager"))).toBe(1);
    expect(await attempt(manager, add(owner.userId, "owner"))).toMatch(denied);
    expect(await attempt(custA, add(custA.userId, "customer"))).toMatch(denied);
    for (const u of [manager, owner]) {
      expect(await attempt(u, sql`update audit_log set action = 'x'`)).toMatch(denied);
      expect(await attempt(u, sql`delete from audit_log`)).toMatch(denied);
    }
  });

  test("customers manage their own addresses and nobody else's", async () => {
    const add = (p: string) => sql`insert into addresses (profile_id, label, line1, city) values (${p}::uuid, 'Home', '1 St', 'Lagos')`;
    expect(await attempt(custA, add(custA.userId))).toBe(1);
    expect(await attempt(custA, add(custB.userId))).toMatch(denied);
    expect(await attempt(kitchen, add(kitchen.userId))).toMatch(denied);
    expect(await attempt(custB, sql`delete from addresses where profile_id = ${custA.userId}::uuid`)).toBe(0);
  });

  test("system can write payments and webhook_events, app roles cannot write webhook_events", async () => {
    await withSystemContext(
      (tx) => tx.execute(sql`insert into webhook_events (provider, event_id, event_type, payload) values ('mock', ${`sys-${orderA1}`}, 'x', '{}')`),
      sysOpts,
    );
    await withSystemContext(
      (tx) =>
        tx.execute(sql`insert into payments (order_id, provider, reference, amount_minor, currency) values (${orderB}::uuid, 'mock', ${`sys-ref-${orderB}`}, 100, 'NGN')`),
      sysOpts,
    );
    expect(
      await attempt(owner, sql`insert into webhook_events (provider, event_id, event_type, payload) values ('mock', 'nope', 'x', '{}')`),
    ).toMatch(denied);
    expect(await attempt(owner, sql`insert into payments (order_id, provider, reference, amount_minor, currency) values (${orderB}::uuid, 'mock', 'nope', 100, 'NGN')`)).toMatch(denied);
  });

  test("order_events cannot be written by any app role", async () => {
    for (const u of [custA, kitchen, manager, owner]) {
      const r = await attempt(u, sql`insert into order_events (order_id, to_status, actor_type) values (${orderA1}::uuid, 'paid', 'staff')`);
      expect(r, u.ctx.role).toMatch(denied);
    }
  });

  test("the app role has no access to the auth tables", async () => {
    for (const t of ["user", "session", "account", "verification"]) {
      expect(await attempt(owner, sql.raw(`select 1 from "${t}"`)), t).toMatch(/permission denied/);
    }
  });
});
