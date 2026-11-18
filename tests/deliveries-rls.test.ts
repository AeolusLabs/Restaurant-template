import { sql } from "drizzle-orm";
import { afterAll, describe, expect, inject, test } from "vitest";
import { closePools, withRequestContext, withSystemContext } from "../src/db/context";
import { admin, closeFixtures, makeOrder, makeUser } from "./helpers/fixtures";

const urls = inject("dbUrls");
const o = { url: urls.app };
afterAll(async () => {
  await closePools();
  await closeFixtures();
});

async function delivery() {
  const owner = await makeUser("customer");
  const { orderId } = await makeOrder(owner.userId, "accepted", "delivery");
  await admin().query(`insert into deliveries (order_id, provider, fee_charged_minor, status) values ($1, 'mock', 150000, 'queued')`, [orderId]);
  return { owner, orderId };
}
const count = (ctx: Parameters<typeof withRequestContext>[0], orderId: string) =>
  withRequestContext(ctx, async (tx) => (await tx.execute(sql`select 1 from deliveries where order_id = ${orderId}::uuid`)).rows.length, o);

describe("deliveries access", () => {
  test("managers and owners read every delivery; the customer reads only their own", async () => {
    const { owner, orderId } = await delivery();
    expect(await count((await makeUser("manager")).ctx, orderId)).toBe(1);
    expect(await count((await makeUser("owner")).ctx, orderId)).toBe(1);
    expect(await count(owner.ctx, orderId)).toBe(1);
    expect(await count((await makeUser("customer")).ctx, orderId)).toBe(0);
  });

  test("the kitchen does not read deliveries, even for orders it can see", async () => {
    const { orderId } = await delivery();
    expect(await count((await makeUser("kitchen")).ctx, orderId)).toBe(0);
  });

  test("nobody in the app role can create, change or delete one", async () => {
    const { owner, orderId } = await delivery();
    for (const ctx of [owner.ctx, (await makeUser("manager")).ctx, (await makeUser("owner")).ctx]) {
      await expect(withRequestContext(ctx, (tx) => tx.execute(sql`insert into deliveries (order_id, provider, fee_charged_minor) values (${orderId}::uuid, 'x', 1)`), o)).rejects.toThrow();
      await expect(withRequestContext(ctx, (tx) => tx.execute(sql`update deliveries set status = 'delivered' where order_id = ${orderId}::uuid`), o)).rejects.toThrow();
      await expect(withRequestContext(ctx, (tx) => tx.execute(sql`delete from deliveries where order_id = ${orderId}::uuid`), o)).rejects.toThrow();
    }
  });

  test("there is one delivery per order", async () => {
    const { orderId } = await delivery();
    await expect(admin().query(`insert into deliveries (order_id, provider, fee_charged_minor) values ($1, 'mock', 1)`, [orderId])).rejects.toThrow(/unique|duplicate/i);
  });

  test("the system role reads and writes them", async () => {
    const { orderId } = await delivery();
    const n = await withSystemContext(async (tx) => {
      await tx.execute(sql`update deliveries set status = 'pending', provider_ref = 'ref-1' where order_id = ${orderId}::uuid`);
      return (await tx.execute(sql`select 1 from deliveries where order_id = ${orderId}::uuid and provider_ref = 'ref-1'`)).rows.length;
    }, { url: urls.system });
    expect(n).toBe(1);
  });
});

describe("wallet snapshots", () => {
  test("managers and owners read them, nobody else does, and only the system writes", async () => {
    await admin().query(`insert into wallet_snapshots (balance_minor) values (123456)`);
    const read = (ctx: Parameters<typeof withRequestContext>[0]) => withRequestContext(ctx, async (tx) => (await tx.execute(sql`select 1 from wallet_snapshots`)).rows.length, o);
    expect(await read((await makeUser("manager")).ctx)).toBeGreaterThan(0);
    expect(await read((await makeUser("owner")).ctx)).toBeGreaterThan(0);
    expect(await read((await makeUser("kitchen")).ctx)).toBe(0);
    expect(await read((await makeUser("customer")).ctx)).toBe(0);
    await expect(withRequestContext((await makeUser("owner")).ctx, (tx) => tx.execute(sql`insert into wallet_snapshots (balance_minor) values (1)`), o)).rejects.toThrow();
  });
});
