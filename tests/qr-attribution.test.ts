import { afterAll, beforeAll, describe, expect, inject, test } from "vitest";
import { restaurantConfig } from "../config/restaurant";
import type { RestaurantConfig } from "../config/schema";
import { closePools } from "../src/db/context";
import { createDeliveryOrder, createPickupOrder } from "../src/db/orders";
import { pickupSlots } from "../src/domain/pickup/slots";
import { generateSlug } from "../src/lib/qr";
import { QR_COOKIE, QR_COOKIE_MAX_AGE_SECONDS, isAutomatedVisit, recordScan } from "../src/qr/scan";
import { admin, closeFixtures, makeUser } from "./helpers/fixtures";

const urls = inject("dbUrls");
const tag = `qa${Date.now().toString(36)}`;
const NOW = new Date();
const allDay = { open: "00:00", close: "23:59" };
const config: RestaurantConfig = {
  ...restaurantConfig,
  features: { ...restaurantConfig.features, delivery: true, pickup: true },
  openingHours: { mon: [allDay], tue: [allDay], wed: [allDay], thu: [allDay], fri: [allDay], sat: [allDay], sun: [allDay] },
  delivery: { ...restaurantConfig.delivery, zones: [{ name: "Island", feeMinor: 150_000 }] },
};
const slot = pickupSlots(NOW, config)[3];
const deps = (over: Record<string, unknown> = {}) => ({ now: NOW, config, appUrl: urls.app, ...over });

let itemId: string;
beforeAll(async () => {
  const cat = (await admin().query(`insert into menu_categories (slug, name) values ($1, 'QR test') returning id`, [`${tag}-cat`])).rows[0].id;
  itemId = (await admin().query(`insert into menu_items (category_id, slug, name, price_minor) values ($1, $2, 'Rice', 100000) returning id`, [cat, `${tag}-rice`])).rows[0].id;
});
afterAll(async () => {
  await closePools();
  await closeFixtures();
});

async function source(active = true) {
  const slug = generateSlug();
  const { rows } = await admin().query(`insert into qr_sources (slug, label, active) values ($1, 'Flyer', $2) returning id`, [slug, active]);
  return { id: rows[0].id as string, slug };
}
let n = 0;
const lines = () => [{ itemId, quantity: 1, modifierIds: [] }]; // a function: the item is made in beforeAll
const delivery = () => ({ lines: lines(), zone: "Island", address: "12 Admiralty Way, Lekki", phone: "+234 803 000 0000", checkoutToken: `${tag}-d-${++n}` });
const pickup = () => ({ lines: lines(), pickupAt: slot, phone: "+234 803 000 0000", checkoutToken: `${tag}-p-${++n}` });
const scans = async (id: string) => (await admin().query(`select 1 from qr_scans where source_id = $1`, [id])).rowCount;

describe("isAutomatedVisit", () => {
  const h = (o: Record<string, string>) => new Headers(o);
  test("prefetches, link previews and crawlers are not people scanning a code", () => {
    expect(isAutomatedVisit(h({ "sec-purpose": "prefetch;prerender" }))).toBe(true);
    expect(isAutomatedVisit(h({ purpose: "prefetch" }))).toBe(true);
    expect(isAutomatedVisit(h({ "x-moz": "prefetch" }))).toBe(true);
    expect(isAutomatedVisit(h({ "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" }))).toBe(true);
    expect(isAutomatedVisit(h({ "user-agent": "WhatsApp/2.23.20 A" }))).toBe(true);
    expect(isAutomatedVisit(h({ "user-agent": "facebookexternalhit/1.1" }))).toBe(true);
  });
  test("an ordinary phone browser is counted", () => {
    expect(isAutomatedVisit(h({ "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1" }))).toBe(false);
    expect(isAutomatedVisit(h({}))).toBe(false);
  });
});

describe("recordScan", () => {
  test("counts a visit to an active source, once each time, and says it was recorded", async () => {
    const s = await source();
    expect(await recordScan(s.slug, { systemUrl: urls.system })).toBe(true);
    expect(await recordScan(s.slug, { systemUrl: urls.system })).toBe(true);
    expect(await scans(s.id)).toBe(2);
  });

  test("a switched-off, unknown or malformed slug records nothing", async () => {
    const off = await source(false);
    expect(await recordScan(off.slug, { systemUrl: urls.system })).toBe(false);
    expect(await recordScan(generateSlug(), { systemUrl: urls.system })).toBe(false);
    expect(await recordScan("../admin", { systemUrl: urls.system })).toBe(false);
    expect(await recordScan("", { systemUrl: urls.system })).toBe(false);
    expect(await scans(off.id)).toBe(0);
  });

  test("a scan stores a source and a time and nothing about the visitor", async () => {
    const cols = (await admin().query(`select column_name from information_schema.columns where table_name = 'qr_scans' order by 1`)).rows.map((r) => r.column_name);
    expect(cols).toEqual(["id", "scanned_at", "source_id"]);
  });

  test("the cookie lasts 7 days", () => {
    expect(QR_COOKIE).toBe("qr_source");
    expect(QR_COOKIE_MAX_AGE_SECONDS).toBe(7 * 24 * 3600);
  });
});

describe("an order remembers the code that brought the customer", () => {
  test("a delivery order and a pickup order both take the source", async () => {
    const s = await source();
    const a = await createDeliveryOrder((await makeUser("customer")).ctx, delivery(), deps({ sourceSlug: s.slug }));
    const b = await createPickupOrder((await makeUser("customer")).ctx, pickup(), deps({ sourceSlug: s.slug }));
    expect(a.order.sourceId).toBe(s.id);
    expect(b.order.sourceId).toBe(s.id);
  });

  test("no code means no source", async () => {
    const { order } = await createDeliveryOrder((await makeUser("customer")).ctx, delivery(), deps());
    expect(order.sourceId).toBeNull();
  });

  test("a switched-off, unknown or malformed source never stops the order, it is just not remembered", async () => {
    const off = await source(false);
    for (const sourceSlug of [off.slug, generateSlug(), "not a slug", "%", ""]) {
      const { order, created } = await createDeliveryOrder((await makeUser("customer")).ctx, delivery(), deps({ sourceSlug }));
      expect(created, sourceSlug).toBe(true);
      expect(order.sourceId, sourceSlug).toBeNull();
    }
  });

  test("a second submit with the same token returns the same order and keeps its source", async () => {
    const s = await source();
    const ctx = (await makeUser("customer")).ctx;
    const body = delivery();
    const a = await createDeliveryOrder(ctx, body, deps({ sourceSlug: s.slug }));
    const b = await createDeliveryOrder(ctx, body, deps({ sourceSlug: generateSlug() }));
    expect(b.created).toBe(false);
    expect(b.order.id).toBe(a.order.id);
    expect(b.order.sourceId).toBe(s.id);
  });
});
