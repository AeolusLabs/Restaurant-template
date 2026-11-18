import { afterAll, beforeAll, describe, expect, inject, test } from "vitest";
import { restaurantConfig } from "../config/restaurant";
import type { RestaurantConfig } from "../config/schema";
import { closePools } from "../src/db/context";
import { OrderRejectedError, createDeliveryOrder, getOrderForCustomer } from "../src/db/orders";
import { deliveryOrderSchema } from "../src/domain/checkout/order-input";
import { admin, closeFixtures, makeUser } from "./helpers/fixtures";

const urls = inject("dbUrls");
const tag = `do${Date.now().toString(36)}`;
const NOW = new Date();
const allDay = { open: "00:00", close: "23:59" };
const config: RestaurantConfig = {
  ...restaurantConfig,
  features: { ...restaurantConfig.features, delivery: true },
  openingHours: { mon: [allDay], tue: [allDay], wed: [allDay], thu: [allDay], fri: [allDay], sat: [allDay], sun: [allDay] },
  charges: { serviceChargeBps: 500, taxBps: 750, pricesIncludeCharges: false },
  delivery: { ...restaurantConfig.delivery, zones: [{ name: "Island", feeMinor: 150_000 }, { name: "Mainland", feeMinor: 250_000 }] },
};
const deps = (over: Record<string, unknown> = {}) => ({ now: NOW, config, appUrl: urls.app, ...over });

let itemId: string;
beforeAll(async () => {
  const cat = (await admin().query(`insert into menu_categories (slug, name) values ($1, 'Delivery test') returning id`, [`${tag}-cat`])).rows[0].id;
  itemId = (await admin().query(`insert into menu_items (category_id, slug, name, price_minor) values ($1, $2, 'Rice', 100000) returning id`, [cat, `${tag}-rice`])).rows[0].id;
});
afterAll(async () => {
  await closePools();
  await closeFixtures();
});

let n = 0;
const input = (over: Record<string, unknown> = {}) => ({
  lines: [{ itemId, quantity: 2, modifierIds: [] }],
  zone: "Island",
  address: "12 Admiralty Way, Lekki",
  landmark: "Blue gate",
  phone: "+234 803 000 0000",
  notes: undefined,
  checkoutToken: `${tag}-tok-${++n}`,
  ...over,
});
const customer = async () => (await makeUser("customer")).ctx;

describe("createDeliveryOrder", () => {
  test("prices the items, adds the zone's fee, and keeps the address with the order", async () => {
    const ctx = await customer();
    const { order, created } = await createDeliveryOrder(ctx, input(), deps());
    expect(created).toBe(true);
    // 2 x 100,000 = 200,000; 5% service = 10,000; 7.5% tax on 210,000 = 15,750; plus 150,000 delivery, untaxed.
    expect(order).toMatchObject({ fulfilment: "delivery", status: "placed", pickupAt: null, subtotalMinor: 200_000, serviceChargeMinor: 10_000, taxMinor: 15_750, deliveryFeeMinor: 150_000, totalMinor: 375_750 });
    const contact = (await admin().query(`select phone, address_snapshot from order_contacts where order_id = $1`, [order.id])).rows[0];
    expect(contact.phone).toBe("+234 803 000 0000");
    expect(contact.address_snapshot).toEqual({ zone: "Island", address: "12 Admiralty Way, Lekki", landmark: "Blue gate" });
  });

  test("the fee follows the zone the customer chose", async () => {
    const ctx = await customer();
    const { order } = await createDeliveryOrder(ctx, input({ zone: "Mainland" }), deps());
    expect(order.deliveryFeeMinor).toBe(250_000);
  });

  test("a fee, total or status sent by the browser is dropped before anything is priced", () => {
    const parsed = deliveryOrderSchema.parse({ ...input(), deliveryFeeMinor: 1, feeMinor: 1, totalMinor: 1, status: "paid" });
    expect(parsed).not.toHaveProperty("deliveryFeeMinor");
    expect(parsed).not.toHaveProperty("feeMinor");
    expect(parsed).not.toHaveProperty("status");
  });

  test("an unknown zone, or delivery switched off, or a closed restaurant, is refused", async () => {
    const ctx = await customer();
    await expect(createDeliveryOrder(ctx, input({ zone: "Moon" }), deps())).rejects.toMatchObject({ code: "invalid_zone" });
    const off = { ...config, features: { ...config.features, delivery: false } };
    await expect(createDeliveryOrder(ctx, input(), deps({ config: off }))).rejects.toMatchObject({ code: "delivery_disabled" });
    const shut = { ...config, openingHours: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] } };
    await expect(createDeliveryOrder(ctx, input(), deps({ config: shut }))).rejects.toMatchObject({ code: "closed" });
    expect((await admin().query(`select 1 from orders where profile_id = $1`, [ctx.userId])).rowCount).toBe(0);
  });

  test("the address must be a real one: not empty, not tiny, not enormous", async () => {
    const ctx = await customer();
    for (const address of ["", "  ", "x", "a".repeat(201)]) {
      await expect(createDeliveryOrder(ctx, input({ address }), deps()), JSON.stringify(address.slice(0, 5))).rejects.toThrow();
    }
    await expect(createDeliveryOrder(ctx, input({ landmark: "l".repeat(101) }), deps())).rejects.toThrow();
  });

  test("an address that looks like HTML is kept as plain text, not interpreted", async () => {
    const ctx = await customer();
    const { order } = await createDeliveryOrder(ctx, input({ address: "<script>alert(1)</script> 5 Main St" }), deps());
    const found = await getOrderForCustomer(ctx, order.publicCode, { url: urls.app });
    expect(found?.order.fulfilment).toBe("delivery");
    const stored = (await admin().query(`select address_snapshot->>'address' as a from order_contacts where order_id = $1`, [order.id])).rows[0].a;
    expect(stored).toBe("<script>alert(1)</script> 5 Main St");
  });

  test("refuses when the total the customer saw (fee included) is no longer the total", async () => {
    const ctx = await customer();
    await expect(createDeliveryOrder(ctx, input({ expectedTotalMinor: 225_750 }), deps())).rejects.toMatchObject({ code: "price_changed" });
    const ok = await createDeliveryOrder(ctx, input({ expectedTotalMinor: 375_750 }), deps());
    expect(ok.order.totalMinor).toBe(375_750);
  });

  test("a second submit with the same token returns the same order", async () => {
    const ctx = await customer();
    const body = input({ checkoutToken: `${tag}-same` });
    const a = await createDeliveryOrder(ctx, body, deps());
    const b = await createDeliveryOrder(ctx, body, deps());
    expect(b.created).toBe(false);
    expect(b.order.id).toBe(a.order.id);
  });

  test("staff accounts cannot place orders", async () => {
    const { ctx } = await makeUser("manager");
    await expect(createDeliveryOrder(ctx, input(), deps())).rejects.toBeInstanceOf(OrderRejectedError);
  });
});
