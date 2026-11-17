import { afterAll, beforeAll, describe, expect, inject, test } from "vitest";
import { closePools, type RequestContext } from "../src/db/context";
import { getOrderForStaff, listOrdersForStaff } from "../src/db/staff-orders";
import type { OrderStatus } from "../src/domain/orders/statuses";
import { toStaffOrder } from "../src/lib/sanitize";
import { admin, closeFixtures, makeOrder, makeUser } from "./helpers/fixtures";

const urls = inject("dbUrls");
const opts = { url: urls.app };
const tag = `so${Date.now().toString(36)}`;

let kitchen: RequestContext, manager: RequestContext, owner: RequestContext, customer: RequestContext;
const orders: Record<string, { orderId: string; code: string }> = {};

async function seed(name: string, status: OrderStatus, customerName = `Cust ${name}`) {
  const { orderId } = await makeOrder((await makeUser("customer")).userId, status);
  const code = `${tag}${name}`.toUpperCase().slice(-12);
  await admin().query(`update orders set public_code = $2, customer_name = $3, notes = 'no onions' where id = $1`, [orderId, code, customerName]);
  await admin().query(`insert into order_contacts (order_id, phone) values ($1, '+2348031112222')`, [orderId]);
  await admin().query(`insert into order_items (order_id, name_snapshot, unit_price_minor_snapshot, quantity, modifiers_snapshot, line_total_minor) values ($1, 'Burger', 100000, 2, '[{"name":"Large","priceDeltaMinor":0}]', 200000)`, [orderId]);
  orders[name] = { orderId, code };
}

beforeAll(async () => {
  [kitchen, manager, owner, customer] = (await Promise.all([makeUser("kitchen"), makeUser("manager"), makeUser("owner"), makeUser("customer")])).map((u) => u.ctx);
  await seed("placed", "placed");
  await seed("paid", "paid", "Ada Lovelace");
  await seed("cooking", "preparing");
  await seed("ready", "ready");
  await seed("done", "completed");
});

afterAll(async () => {
  await closePools();
  await closeFixtures();
});

const mine = <T extends { order: { publicCode: string } }>(rows: T[]) => {
  const ours = new Set(Object.values(orders).map((o) => o.code));
  return rows.filter((r) => ours.has(r.order.publicCode));
};

describe("listOrdersForStaff", () => {
  test("the kitchen sees only orders it has to work on, with their items, and never a phone number", async () => {
    const rows = mine(await listOrdersForStaff(kitchen, {}, opts));
    expect(rows.map((r) => r.order.status).sort()).toEqual(["paid", "preparing", "ready"]);
    expect(rows.every((r) => r.phone === null)).toBe(true);
    expect(rows[0].items[0]).toMatchObject({ name: "Burger", quantity: 2 });
  });

  test("a manager sees every order, with the phone number", async () => {
    const rows = mine(await listOrdersForStaff(manager, {}, opts));
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.phone === "+2348031112222")).toBe(true);
  });

  test("filters by status", async () => {
    const rows = mine(await listOrdersForStaff(owner, { statuses: ["completed", "placed"] }, opts));
    expect(rows.map((r) => r.order.status).sort()).toEqual(["completed", "placed"]);
  });

  test("searches by order code or customer name, ignoring case", async () => {
    expect(mine(await listOrdersForStaff(manager, { search: orders.paid.code.toLowerCase() }, opts))).toHaveLength(1);
    expect(mine(await listOrdersForStaff(manager, { search: "lovelace" }, opts)).map((r) => r.order.status)).toEqual(["paid"]);
    expect(mine(await listOrdersForStaff(manager, { search: "no-such-person-xyz" }, opts))).toEqual([]);
  });

  test("a search with wildcard characters finds only what it spells", async () => {
    expect(await listOrdersForStaff(manager, { search: "%" }, opts)).toEqual([]);
    expect(await listOrdersForStaff(manager, { search: "_" }, opts)).toEqual([]);
  });

  test("newest first, and capped by the limit", async () => {
    const rows = await listOrdersForStaff(manager, { limit: 2 }, opts);
    expect(rows).toHaveLength(2);
    expect(rows[0].order.placedAt.getTime()).toBeGreaterThanOrEqual(rows[1].order.placedAt.getTime());
  });

  test("a customer asking through this function sees only their own orders", async () => {
    expect(mine(await listOrdersForStaff(customer, {}, opts))).toEqual([]);
  });
});

describe("getOrderForStaff", () => {
  test("a manager gets the order with events, payments and refunds", async () => {
    const { orderId, code } = orders.done;
    await admin().query(`insert into order_events (order_id, from_status, to_status, actor_type) values ($1, 'ready', 'completed', 'staff')`, [orderId]);
    await admin().query(`insert into payments (order_id, provider, reference, amount_minor, currency, status) values ($1, 'mock', $2, 200000, 'NGN', 'succeeded')`, [orderId, `ref-${code}`]);
    const found = await getOrderForStaff(manager, code, opts);
    expect(found?.phone).toBe("+2348031112222");
    expect(found?.events.map((e) => e.to)).toEqual(["completed"]);
    expect(found?.payments).toEqual([expect.objectContaining({ reference: `ref-${code}`, status: "succeeded", amountMinor: 200_000 })]);
    expect(found?.refunds).toEqual([]);
  });

  test("the kitchen gets its order without contact details or payment records", async () => {
    const found = await getOrderForStaff(kitchen, orders.ready.code, opts);
    expect(found?.order.status).toBe("ready");
    expect(found?.phone).toBeNull();
    expect(found?.payments).toEqual([]);
  });

  test("the kitchen cannot open an order that is not its business, and an unknown code finds nothing", async () => {
    expect(await getOrderForStaff(kitchen, orders.placed.code, opts)).toBeNull();
    expect(await getOrderForStaff(manager, "NOSUCHCODE", opts)).toBeNull();
  });
});

describe("toStaffOrder", () => {
  test("lists whitelisted fields only: no owner id, no internal ids", async () => {
    const found = (await getOrderForStaff(manager, orders.paid.code, opts))!;
    const json = toStaffOrder(found.order, found.items, found.phone);
    expect(Object.keys(json).sort()).toEqual(
      ["customerName", "fulfilment", "items", "notes", "phone", "pickupAt", "placedAt", "publicCode", "status", "totalMinor"].sort(),
    );
    expect(JSON.stringify(json)).not.toContain(found.order.id);
    expect(JSON.stringify(json)).not.toContain(found.order.profileId!);
  });
});
