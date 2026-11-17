import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, test } from "vitest";
import { closePools, withPublicContext, withSystemContext } from "../src/db/context";
import { transitionOrderIn } from "../src/db/transition-order";
import { admin, closeFixtures, makeOrder, makeUser } from "./helpers/fixtures";

const urls = inject("dbUrls");

afterAll(async () => {
  await closePools();
  await closeFixtures();
});

describe("withPublicContext", () => {
  let activeSlug: string;
  let hiddenSlug: string;

  beforeAll(async () => {
    const tag = Date.now().toString(36);
    activeSlug = `public-active-${tag}`;
    hiddenSlug = `public-hidden-${tag}`;
    const {
      rows: [cat],
    } = await admin().query(`insert into menu_categories (slug, name) values ($1, 'Public test') returning id`, [`public-${tag}`]);
    await admin().query(
      `insert into menu_items (category_id, slug, name, price_minor, active) values ($1, $2, 'Visible', 1000, true), ($1, $3, 'Hidden', 1000, false)`,
      [cat.id, activeSlug, hiddenSlug],
    );
    const { userId } = await makeUser("customer");
    await makeOrder(userId);
  });

  test("reads active menu items with no identity, and not inactive ones", async () => {
    const rows = await withPublicContext((tx) => tx.execute(sql`select slug from menu_items where slug in (${activeSlug}, ${hiddenSlug})`), {
      url: urls.app,
    });
    expect(rows.rows.map((r) => r.slug)).toEqual([activeSlug]);
  });

  test("reads no orders and cannot create one", async () => {
    const seen = await withPublicContext((tx) => tx.execute(sql`select id from orders`), { url: urls.app });
    expect(seen.rows).toHaveLength(0);
    await expect(
      withPublicContext(
        (tx) =>
          tx.execute(
            sql`insert into orders (public_code, profile_id, customer_name, fulfilment, subtotal_minor, total_minor, currency) values ('ANON01', null, 'x', 'pickup', 1, 1, 'NGN')`,
          ),
        { url: urls.app },
      ),
    ).rejects.toThrow();
  });
});

describe("transitionOrderIn", () => {
  test("joins the caller's transaction, so a later failure rolls the transition back", async () => {
    const { userId } = await makeUser("customer");
    const { orderId } = await makeOrder(userId);
    await expect(
      withSystemContext(
        async (tx) => {
          await transitionOrderIn(tx, { orderId, to: "paid", actor: { type: "system" } });
          throw new Error("later step failed");
        },
        { url: urls.system },
      ),
    ).rejects.toThrow("later step failed");
    const { rows } = await admin().query(`select status from orders where id = $1`, [orderId]);
    expect(rows[0].status).toBe("placed");
    const events = await admin().query(`select 1 from order_events where order_id = $1`, [orderId]);
    expect(events.rowCount).toBe(0);
  });

  test("commits the transition and its event together when the caller succeeds", async () => {
    const { userId } = await makeUser("customer");
    const { orderId } = await makeOrder(userId);
    await withSystemContext((tx) => transitionOrderIn(tx, { orderId, to: "paid", actor: { type: "system" } }), { url: urls.system });
    const { rows } = await admin().query(`select status from orders where id = $1`, [orderId]);
    expect(rows[0].status).toBe("paid");
    expect((await admin().query(`select 1 from order_events where order_id = $1 and to_status = 'paid'`, [orderId])).rowCount).toBe(1);
  });
});

describe("migration 0007", () => {
  test("removing a customer's auth user, as the system role, keeps their orders with no owner", async () => {
    const { userId } = await makeUser("customer");
    const { orderId } = await makeOrder(userId);
    await withSystemContext((tx) => tx.execute(sql`delete from "user" where id = ${userId}::uuid`), { url: urls.system });
    const { rows } = await admin().query(`select profile_id from orders where id = $1`, [orderId]);
    expect(rows).toEqual([{ profile_id: null }]);
    expect((await admin().query(`select 1 from profiles where id = $1`, [userId])).rowCount).toBe(0);
  });

  test("a checkout token is unique per customer, and orders without one are unlimited", async () => {
    const { userId } = await makeUser("customer");
    const insert = (token: string | null) =>
      admin().query(
        `insert into orders (public_code, profile_id, customer_name, fulfilment, subtotal_minor, total_minor, currency, checkout_token)
         values (substr(md5(random()::text), 1, 8), $1, 'T', 'pickup', 1, 1, 'NGN', $2)`,
        [userId, token],
      );
    await insert("tok-1");
    await expect(insert("tok-1")).rejects.toThrow(/unique|duplicate/i);
    await insert("tok-2");
    await insert(null);
    await insert(null);
  });

  test("the system role can now update an order's contact row, for anonymisation", async () => {
    const { userId } = await makeUser("customer");
    const { orderId } = await makeOrder(userId);
    await admin().query(`insert into order_contacts (order_id, phone) values ($1, '+2348000000000')`, [orderId]);
    await withSystemContext((tx) => tx.execute(sql`update order_contacts set phone = '' where order_id = ${orderId}::uuid`), { url: urls.system });
    expect((await admin().query(`select phone from order_contacts where order_id = $1`, [orderId])).rows[0].phone).toBe("");
  });
});
