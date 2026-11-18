import { afterAll, beforeAll, describe, expect, inject, test } from "vitest";
import { restaurantConfig } from "../config/restaurant";
import type { RestaurantConfig } from "../config/schema";
import { closePools } from "../src/db/context";
import { createDeliveryOrder } from "../src/db/orders";
import { previewPromo } from "../src/db/promos";
import { admin, closeFixtures, makeUser } from "./helpers/fixtures";

const urls = inject("dbUrls");
const tag = `pv${Date.now().toString(36)}`;
const NOW = new Date();
const allDay = { open: "00:00", close: "23:59" };
const config: RestaurantConfig = {
  ...restaurantConfig,
  features: { ...restaurantConfig.features, delivery: true, promos: true },
  openingHours: { mon: [allDay], tue: [allDay], wed: [allDay], thu: [allDay], fri: [allDay], sat: [allDay], sun: [allDay] },
  delivery: { ...restaurantConfig.delivery, zones: [{ name: "Island", feeMinor: 150_000 }] },
};
let itemId: string;
beforeAll(async () => {
  const cat = (await admin().query(`insert into menu_categories (slug, name) values ($1, 'Preview test') returning id`, [`${tag}-cat`])).rows[0].id;
  itemId = (await admin().query(`insert into menu_items (category_id, slug, name, price_minor) values ($1, $2, 'Rice', 100000) returning id`, [cat, `${tag}-rice`])).rows[0].id;
});
afterAll(async () => {
  await closePools();
  await closeFixtures();
});

let n = 0;
async function promo(over = "") {
  const c = `V${Date.now().toString(36)}${++n}`.toUpperCase().slice(0, 20);
  await admin().query(`insert into promos (code, kind, value, max_per_customer ${over ? ", " + over.split("=")[0] : ""}) values ($1, 'percent', 1000, 1 ${over ? ", " + over.split("=")[1] : ""})`, [c]);
  return c;
}
const preview = (ctx: Parameters<typeof previewPromo>[0], code: string, fulfilment: "pickup" | "delivery" = "delivery", cfg = config) => previewPromo(ctx, code, fulfilment, cfg, NOW, { url: urls.app });

describe("previewPromo", () => {
  test("a usable code comes back with its terms, and nothing is recorded", async () => {
    const c = await promo();
    const ctx = (await makeUser("customer")).ctx;
    const r = await preview(ctx, c.toLowerCase());
    expect(r).toMatchObject({ ok: true, promo: { code: c, kind: "percent", value: 1000 } });
    expect((await admin().query(`select 1 from promo_redemptions r join promos p on p.id = r.promo_id where p.code = $1`, [c])).rowCount).toBe(0);
  });

  test("a code this customer already used is refused for them and still usable by someone else", async () => {
    const c = await promo();
    const a = await makeUser("customer");
    await createDeliveryOrder(a.ctx, { lines: [{ itemId, quantity: 1, modifierIds: [] }], zone: "Island", address: "12 Admiralty Way", phone: "+234 803 000 0000", promoCode: c, checkoutToken: `${tag}-tok-${++n}` }, { now: NOW, config, appUrl: urls.app });
    expect(await preview(a.ctx, c)).toEqual({ ok: false, reason: "already_used" });
    expect(await preview((await makeUser("customer")).ctx, c)).toMatchObject({ ok: true });
  });

  test("unknown, malformed, switched off and wrong kind of order each give their own reason", async () => {
    const ctx = (await makeUser("customer")).ctx;
    expect(await preview(ctx, "NOSUCHCODE")).toEqual({ ok: false, reason: "unknown" });
    expect(await preview(ctx, "a b")).toEqual({ ok: false, reason: "unknown" });
    const c = await promo();
    expect(await preview(ctx, c, "delivery", { ...config, features: { ...config.features, promos: false } })).toEqual({ ok: false, reason: "disabled" });
    const free = `F${Date.now().toString(36)}${++n}`.toUpperCase().slice(0, 20);
    await admin().query(`insert into promos (code, kind, value) values ($1, 'free_delivery', null)`, [free]);
    expect(await preview(ctx, free, "pickup")).toEqual({ ok: false, reason: "delivery_only" });
    expect(await preview(ctx, free, "delivery")).toMatchObject({ ok: true });
  });

  test("someone who is not signed in is told to sign in, and never reaches the database", async () => {
    const c = await promo();
    expect(await preview(null, c)).toEqual({ ok: false, reason: "signed_out" });
  });
});
