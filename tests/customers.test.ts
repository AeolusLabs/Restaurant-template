import { afterAll, describe, expect, inject, test } from "vitest";
import { ForbiddenError } from "../src/auth/session";
import { closePools } from "../src/db/context";
import { getCustomer, listCustomers } from "../src/db/customers";
import { admin, closeFixtures, makeOrder, makeUser } from "./helpers/fixtures";

const urls = inject("dbUrls");
const d = { systemUrl: urls.system };
afterAll(async () => {
  await closePools();
  await closeFixtures();
});

/** A customer with a unique name, so a search finds exactly them among everything other tests left behind. */
async function customer(over: { name?: string; phone?: string } = {}) {
  const u = await makeUser("customer");
  const name = over.name ?? `Zed ${u.userId.slice(0, 8)}`;
  await admin().query(`update profiles set full_name = $2, phone = $3 where id = $1`, [u.userId, name, over.phone ?? null]);
  return { ...u, name, email: `customer+${u.userId}@example.com`.replace(/^customer/, "customer"), needle: u.userId };
}
const paid = async (profileId: string, status: "paid" | "completed" | "cancelled" | "placed" = "completed", totalMinor = 100_000) => {
  const { orderId } = await makeOrder(profileId, status);
  await admin().query(`update orders set total_minor = $2 where id = $1`, [orderId, totalMinor]);
  if (status !== "placed" && status !== "cancelled") await admin().query(`insert into payments (order_id, provider, reference, amount_minor, currency, status) values ($1, 'mock', $2, $3, 'NGN', 'succeeded')`, [orderId, `pay-${orderId}`, totalMinor]);
  return orderId;
};
const find = async (ctx: Parameters<typeof listCustomers>[0], needle: string) => (await listCustomers(ctx, { search: needle }, d))[0];

describe("listCustomers", () => {
  test("shows a customer with their email, phone, paid orders, completed spend and last order", async () => {
    const manager = (await makeUser("manager")).ctx;
    const c = await customer({ phone: "+234 803 555 0101" });
    await paid(c.userId, "completed", 300_000);
    await paid(c.userId, "completed", 200_000);
    await paid(c.userId, "paid", 150_000); // paid but not finished: counts as an order, not yet as spend
    await paid(c.userId, "cancelled"); // never paid
    await paid(c.userId, "placed"); // not paid yet
    const row = await find(manager, c.needle);
    expect(row).toMatchObject({ id: c.userId, name: c.name, phone: "+234 803 555 0101", blocked: false, orders: 3, spentMinor: 500_000 });
    expect(row.email).toContain(c.userId);
    expect(row.lastOrderAt).toBeInstanceOf(Date);
  });

  test("a refunded order is not spend", async () => {
    const manager = (await makeUser("manager")).ctx;
    const c = await customer();
    const id = await paid(c.userId, "completed", 400_000);
    await admin().query(`update orders set status = 'refunded' where id = $1`, [id]);
    await admin().query(`update payments set status = 'refunded' where order_id = $1`, [id]);
    expect(await find(manager, c.needle)).toMatchObject({ orders: 1, spentMinor: 0 });
  });

  test("a customer with no orders is listed with zeros and no last order", async () => {
    const owner = (await makeUser("owner")).ctx;
    const c = await customer();
    expect(await find(owner, c.needle)).toMatchObject({ orders: 0, spentMinor: 0, lastOrderAt: null });
  });

  test("a search finds by name, email or phone, in any case, and a percent sign is not a wildcard", async () => {
    const manager = (await makeUser("manager")).ctx;
    const c = await customer({ name: `Quincy Adebayo ${Date.now()}`, phone: "+234 809 777 0202" });
    expect((await listCustomers(manager, { search: "quincy adebayo" }, d)).some((r) => r.id === c.userId)).toBe(true);
    expect((await listCustomers(manager, { search: "809 777 0202" }, d)).some((r) => r.id === c.userId)).toBe(true);
    expect((await listCustomers(manager, { search: c.needle.toUpperCase() }, d)).map((r) => r.id)).toEqual([c.userId]);
    expect(await listCustomers(manager, { search: "%%%%%%%%nomatch" }, d)).toEqual([]);
  });

  test("staff are never listed as customers", async () => {
    const manager = await makeUser("manager");
    expect(await listCustomers(manager.ctx, { search: manager.userId }, d)).toEqual([]);
  });

  test("it can be ordered by spend, by orders, or by who joined last", async () => {
    const manager = (await makeUser("manager")).ctx;
    const tag = `Sortco${Date.now()}`;
    const [a, b, c] = [await customer({ name: `${tag} A` }), await customer({ name: `${tag} B` }), await customer({ name: `${tag} C` })];
    await paid(a.userId, "completed", 100_000);
    await paid(b.userId, "completed", 900_000);
    await paid(c.userId, "completed", 200_000);
    await paid(c.userId, "completed", 200_000);
    await paid(c.userId, "completed", 200_000);
    const ids = async (sort: "spend" | "orders" | "joined" | "recent") => (await listCustomers(manager, { search: tag, sort }, d)).map((r) => r.id);
    expect(await ids("spend")).toEqual([b.userId, c.userId, a.userId]); // 900,000, then 600,000, then 100,000
    expect((await ids("orders"))[0]).toBe(c.userId);
    expect((await ids("joined"))[0]).toBe(c.userId);
    expect((await ids("recent"))).toHaveLength(3);
  });

  test("only managers and owners can look", async () => {
    for (const role of ["kitchen", "customer"] as const) {
      await expect(listCustomers((await makeUser(role)).ctx, {}, d), role).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});

describe("getCustomer", () => {
  test("one customer with their orders, newest first, and whether they agreed to marketing", async () => {
    const manager = (await makeUser("manager")).ctx;
    const c = await customer();
    const first = await paid(c.userId, "completed", 100_000);
    const second = await paid(c.userId, "paid", 250_000);
    await admin().query(`update orders set placed_at = now() - interval '2 days', promo_code = 'WELCOME10' where id = $1`, [first]);
    await admin().query(`insert into consents (profile_id, type, policy_version) values ($1, 'marketing', 'v1')`, [c.userId]);
    const got = await getCustomer(manager, c.userId, d);
    expect(got).toMatchObject({ id: c.userId, name: c.name, orders: 2, spentMinor: 100_000, marketingConsent: true });
    expect(got!.orderList.map((o) => o.totalMinor)).toEqual([250_000, 100_000]);
    expect(got!.orderList[1]).toMatchObject({ status: "completed", promoCode: "WELCOME10" });
    expect(got!.orderList[0].publicCode).toBeTruthy();
    expect(second).toBeTruthy();
  });

  test("a withdrawn marketing consent is not consent, and no consent row is not consent", async () => {
    const manager = (await makeUser("manager")).ctx;
    const withdrawn = await customer();
    await admin().query(`insert into consents (profile_id, type, policy_version, withdrawn_at) values ($1, 'marketing', 'v1', now())`, [withdrawn.userId]);
    expect((await getCustomer(manager, withdrawn.userId, d))?.marketingConsent).toBe(false);
    expect((await getCustomer(manager, (await customer()).userId, d))?.marketingConsent).toBe(false);
  });

  test("a staff member or an unknown id is not a customer", async () => {
    const manager = await makeUser("manager");
    expect(await getCustomer(manager.ctx, manager.userId, d)).toBeNull();
    expect(await getCustomer(manager.ctx, "00000000-0000-4000-8000-000000000000", d)).toBeNull();
  });

  test("only managers and owners can look", async () => {
    const c = await customer();
    for (const role of ["kitchen", "customer"] as const) {
      await expect(getCustomer((await makeUser(role)).ctx, c.userId, d), role).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});
