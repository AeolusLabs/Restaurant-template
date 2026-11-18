import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, test } from "vitest";
import { restaurantConfig } from "../config/restaurant";
import type { RestaurantConfig } from "../config/schema";
import { closePools, withRequestContext } from "../src/db/context";
import {
  OrderRejectedError,
  cancelUnpaidOrder,
  createPickupOrder,
  getOrderForCustomer,
  listOrdersForCustomer,
} from "../src/db/orders";
import { IllegalTransitionError, OrderNotFoundError } from "../src/domain/orders/transitions";
import { createOrderSchema } from "../src/domain/checkout/order-input";
import { pickupSlots } from "../src/domain/pickup/slots";
import { toPublicOrder } from "../src/lib/sanitize";
import { admin, closeFixtures, makeUser } from "./helpers/fixtures";

const urls = inject("dbUrls");
const tag = `co${Date.now().toString(36)}`;
// Real time, so orders made here are never overdue for the expiry job another test file runs at the same moment.
const NOW = new Date();

const allDay = { open: "00:00", close: "23:59" };
const config: RestaurantConfig = {
  ...restaurantConfig,
  features: { ...restaurantConfig.features, pickup: true },
  openingHours: { mon: [allDay], tue: [allDay], wed: [allDay], thu: [allDay], fri: [allDay], sat: [allDay], sun: [allDay] },
  charges: { serviceChargeBps: 500, taxBps: 750, pricesIncludeCharges: false },
  orders: { ...restaurantConfig.orders, unpaidExpiryMinutes: 30 },
};
const deps = (over: Record<string, unknown> = {}) => ({ now: NOW, config, appUrl: urls.app, ...over });
const slot = pickupSlots(NOW, config)[3];

const ids: Record<string, string> = {};
const modIds: Record<string, string> = {};

beforeAll(async () => {
  const one = async (sql: string, params: unknown[]): Promise<string> => (await admin().query(sql, params)).rows[0].id as string;
  const cat = await one(`insert into menu_categories (slug, name) values ($1, 'Orders test') returning id`, [`${tag}-cat`]);
  const item = (slug: string, name: string, price: number, active = true, available = true) =>
    one(`insert into menu_items (category_id, slug, name, price_minor, active, available) values ($1, $2, $3, $4, $5, $6) returning id`, [
      cat, `${tag}-${slug}`, name, price, active, available,
    ]);
  ids.burger = await item("burger", "Burger", 450_000);
  ids.water = await item("water", "Water", 50_000);
  ids.soldOut = await item("sold", "Sold out", 100_000, true, false);
  ids.retired = await item("retired", "Retired", 100_000, false);
  const group = await one(`insert into modifier_groups (item_id, name, min_select, max_select) values ($1, 'Size', 1, 1) returning id`, [ids.burger]);
  modIds.regular = await one(`insert into modifiers (group_id, name, price_delta_minor) values ($1, 'Regular', 0) returning id`, [group]);
  modIds.large = await one(`insert into modifiers (group_id, name, price_delta_minor) values ($1, 'Large', 100000) returning id`, [group]);
});

afterAll(async () => {
  await closePools();
  await closeFixtures();
});

let counter = 0;
const input = (over: Record<string, unknown> = {}) => ({
  lines: [{ itemId: ids.burger, quantity: 2, modifierIds: [modIds.large] }],
  pickupAt: slot,
  phone: "+234 803 000 0000",
  notes: undefined,
  checkoutToken: `${tag}-tok-${++counter}`,
  ...over,
});
const customer = async () => (await makeUser("customer")).ctx;

describe("createPickupOrder", () => {
  test("prices the order on the server, from the database and config", async () => {
    const ctx = await customer();
    const { order, created } = await createPickupOrder(ctx, input(), deps());
    expect(created).toBe(true);
    // 2 x (450,000 + 100,000) = 1,100,000; 5% service = 55,000; 7.5% tax on 1,155,000 = 86,625.
    expect(order).toMatchObject({
      status: "placed",
      fulfilment: "pickup",
      subtotalMinor: 1_100_000,
      serviceChargeMinor: 55_000,
      taxMinor: 86_625,
      deliveryFeeMinor: 0,
      discountMinor: 0,
      totalMinor: 1_241_625,
      currency: "NGN",
    });
    expect(order.pickupAt!.toISOString()).toBe(slot.toISOString());
    expect(order.expiresAt!.toISOString()).toBe(new Date(NOW.getTime() + 30 * 60_000).toISOString());
    expect(order.publicCode).toMatch(/^[2-9A-HJ-NP-Z]{6}$/);
  });

  test("the boundary schema drops a client price, total or status before anything is priced", () => {
    const parsed = createOrderSchema.parse({
      lines: [{ itemId: ids.burger, quantity: 1, modifierIds: [modIds.regular], priceMinor: 1, total: 1 }],
      pickupAt: slot.toISOString(),
      phone: "08030000000",
      checkoutToken: "abcdefgh1234",
      totalMinor: 1,
      status: "paid",
    });
    expect(parsed).not.toHaveProperty("totalMinor");
    expect(parsed).not.toHaveProperty("status");
    expect(parsed.lines[0]).not.toHaveProperty("priceMinor");
    expect(parsed.pickupAt).toBeInstanceOf(Date);
  });

  test("copies names, prices and modifiers onto the order, so a later menu edit cannot change it", async () => {
    const ctx = await customer();
    const { order } = await createPickupOrder(ctx, input(), deps());
    await admin().query(`update menu_items set price_minor = 1, name = 'Renamed' where id = $1`, [ids.burger]);
    try {
      const view = await getOrderForCustomer(ctx, order.publicCode, { url: urls.app });
      expect(view?.items).toEqual([
        {
          name: "Burger",
          quantity: 2,
          unitPriceMinor: 550_000,
          modifiers: [{ name: "Large", priceDeltaMinor: 100_000 }],
          lineTotalMinor: 1_100_000,
        },
      ]);
    } finally {
      await admin().query(`update menu_items set price_minor = 450000, name = 'Burger' where id = $1`, [ids.burger]);
    }
  });

  test("takes the customer's name from their profile and stores the phone and notes", async () => {
    const ctx = await customer();
    const { order } = await createPickupOrder(ctx, input({ notes: "No onions" }), deps());
    const row = (await admin().query(`select customer_name, notes from orders where public_code = $1`, [order.publicCode])).rows[0];
    expect(row).toEqual({ customer_name: "Test customer", notes: "No onions" });
    const contact = (await admin().query(`select phone from order_contacts where order_id = $1`, [order.id])).rows[0];
    expect(contact.phone).toBe("+234 803 000 0000");
  });

  test("refuses a closed pickup slot, a past one and one off the grid", async () => {
    const ctx = await customer();
    for (const pickupAt of [new Date(NOW.getTime() - 3_600_000), new Date(slot.getTime() + 60_000), new Date(NOW.getTime() + 20 * 86_400_000)]) {
      await expect(createPickupOrder(ctx, input({ pickupAt }), deps())).rejects.toMatchObject({ code: "invalid_slot" });
    }
  });

  test("refuses an unknown, retired or sold-out item and names the line", async () => {
    const ctx = await customer();
    const attempt = createPickupOrder(
      ctx,
      input({
        lines: [
          { itemId: ids.water, quantity: 1, modifierIds: [] },
          { itemId: ids.soldOut, quantity: 1, modifierIds: [] },
          { itemId: ids.retired, quantity: 1, modifierIds: [] },
          { itemId: randomUUID(), quantity: 1, modifierIds: [] },
        ],
      }),
      deps(),
    );
    await expect(attempt).rejects.toBeInstanceOf(OrderRejectedError);
    await expect(attempt).rejects.toMatchObject({
      code: "cart_problems",
      problems: [
        { index: 1, code: "sold_out" },
        { index: 2, code: "not_found" }, // a retired item is invisible to customers
        { index: 3, code: "not_found" },
      ],
    });
  });

  test("refuses when a required modifier choice is missing", async () => {
    const ctx = await customer();
    await expect(createPickupOrder(ctx, input({ lines: [{ itemId: ids.burger, quantity: 1, modifierIds: [] }] }), deps())).rejects.toMatchObject({
      code: "cart_problems",
      problems: [{ index: 0, code: "selection_count" }],
    });
  });

  test("refuses when pickup is switched off in config, and for staff accounts", async () => {
    const ctx = await customer();
    const off = { ...config, features: { ...config.features, pickup: false } };
    await expect(createPickupOrder(ctx, input(), deps({ config: off }))).rejects.toMatchObject({ code: "pickup_disabled" });
    const { ctx: manager } = await makeUser("manager");
    await expect(createPickupOrder(manager, input(), deps())).rejects.toMatchObject({ code: "not_a_customer" });
  });

  test("refuses, and creates nothing, when the total the customer saw is no longer the total", async () => {
    const ctx = await customer();
    await expect(createPickupOrder(ctx, input({ expectedTotalMinor: 1_000_000 }), deps())).rejects.toMatchObject({ code: "price_changed" });
    expect((await admin().query(`select 1 from orders where profile_id = $1`, [ctx.userId])).rowCount).toBe(0);
    const ok = await createPickupOrder(ctx, input({ expectedTotalMinor: 1_241_625 }), deps());
    expect(ok.order.totalMinor).toBe(1_241_625);
  });

  test("a second submit with the same token returns the same order and creates nothing new", async () => {
    const ctx = await customer();
    const first = await createPickupOrder(ctx, input({ checkoutToken: `${tag}-same` }), deps());
    const second = await createPickupOrder(ctx, input({ checkoutToken: `${tag}-same` }), deps());
    expect(second.created).toBe(false);
    expect(second.order.id).toBe(first.order.id);
    expect((await admin().query(`select 1 from orders where profile_id = $1`, [ctx.userId])).rowCount).toBe(1);
  });

  test("two submits arriving at the same moment still make one order", async () => {
    const ctx = await customer();
    const body = input({ checkoutToken: `${tag}-race` });
    const [a, b] = await Promise.all([createPickupOrder(ctx, body, deps()), createPickupOrder(ctx, body, deps())]);
    expect(a.order.id).toBe(b.order.id);
    expect([a.created, b.created].sort()).toEqual([false, true]);
    expect((await admin().query(`select 1 from orders where profile_id = $1`, [ctx.userId])).rowCount).toBe(1);
  });

  test("the same token from a different customer is a different order", async () => {
    const [one, two] = [await customer(), await customer()];
    const a = await createPickupOrder(one, input({ checkoutToken: `${tag}-shared` }), deps());
    const b = await createPickupOrder(two, input({ checkoutToken: `${tag}-shared` }), deps());
    expect(a.order.id).not.toBe(b.order.id);
  });

  test("a public code that is already taken is retried with a new one", async () => {
    const ctx = await customer();
    const first = await createPickupOrder(ctx, input(), deps({ code: () => "AAAAA2" }));
    expect(first.order.publicCode).toBe("AAAAA2");
    const codes = ["AAAAA2", "AAAAA2", "BBBBB3"];
    const next = await createPickupOrder(ctx, input(), deps({ code: () => codes.shift()! }));
    expect(next.order.publicCode).toBe("BBBBB3");
  });
});

describe("reading and cancelling orders", () => {
  test("a customer sees their own order and nobody else's", async () => {
    const [owner, stranger] = [await customer(), await customer()];
    const { order } = await createPickupOrder(owner, input(), deps());
    expect((await getOrderForCustomer(owner, order.publicCode, { url: urls.app }))?.order.publicCode).toBe(order.publicCode);
    expect(await getOrderForCustomer(stranger, order.publicCode, { url: urls.app })).toBeNull();
    expect(await listOrdersForCustomer(stranger, { url: urls.app })).toEqual([]);
  });

  test("the kitchen can read a paid order but not the customer's phone", async () => {
    const owner = await customer();
    const { ctx: kitchen } = await makeUser("kitchen");
    const { order } = await createPickupOrder(owner, input(), deps());
    await admin().query(`update orders set status = 'paid' where id = $1`, [order.id]);
    const seen = await withRequestContext(
      kitchen,
      async (tx) => ({
        orders: (await tx.execute(`select 1 from orders where id = '${order.id}'`)).rows.length,
        contacts: (await tx.execute(`select 1 from order_contacts where order_id = '${order.id}'`)).rows.length,
      }),
      { url: urls.app },
    );
    expect(seen).toEqual({ orders: 1, contacts: 0 });
  });

  test("lists a customer's orders, newest first", async () => {
    const ctx = await customer();
    const a = await createPickupOrder(ctx, input(), deps());
    await admin().query(`update orders set placed_at = placed_at - interval '1 hour' where id = $1`, [a.order.id]);
    const b = await createPickupOrder(ctx, input(), deps());
    const list = await listOrdersForCustomer(ctx, { url: urls.app });
    expect(list.map((o) => o.publicCode)).toEqual([b.order.publicCode, a.order.publicCode]);
  });

  test("a customer can cancel an unpaid order, but not one that is paid", async () => {
    const ctx = await customer();
    const { order } = await createPickupOrder(ctx, input(), deps());
    await cancelUnpaidOrder(ctx, order.publicCode, { appUrl: urls.app });
    expect((await admin().query(`select status from orders where id = $1`, [order.id])).rows[0].status).toBe("cancelled");

    const paid = await createPickupOrder(ctx, input(), deps());
    await admin().query(`update orders set status = 'paid' where id = $1`, [paid.order.id]);
    await expect(cancelUnpaidOrder(ctx, paid.order.publicCode, { appUrl: urls.app })).rejects.toBeInstanceOf(IllegalTransitionError);
  });

  test("cancelling someone else's order, or one that does not exist, finds nothing", async () => {
    const [owner, stranger] = [await customer(), await customer()];
    const { order } = await createPickupOrder(owner, input(), deps());
    await expect(cancelUnpaidOrder(stranger, order.publicCode, { appUrl: urls.app })).rejects.toBeInstanceOf(OrderNotFoundError);
    await expect(cancelUnpaidOrder(owner, "ZZZZZZ", { appUrl: urls.app })).rejects.toBeInstanceOf(OrderNotFoundError);
  });
});

describe("toPublicOrder", () => {
  test("lists only whitelisted fields: no ids, no profile, no contact details", async () => {
    const ctx = await customer();
    const { order } = await createPickupOrder(ctx, input(), deps());
    const view = await getOrderForCustomer(ctx, order.publicCode, { url: urls.app });
    const json = toPublicOrder(view!.order, view!.items);
    expect(Object.keys(json).sort()).toEqual(
      [
        "currency", "delivery", "deliveryFeeMinor", "discountMinor", "dropoff", "expiresAt", "fulfilment", "items", "notes", "pickupAt", "placedAt",
        "promoCode", "publicCode", "serviceChargeMinor", "status", "subtotalMinor", "taxMinor", "totalMinor",
      ].sort(),
    );
    expect(JSON.stringify(json)).not.toContain(ctx.userId);
  });
});
