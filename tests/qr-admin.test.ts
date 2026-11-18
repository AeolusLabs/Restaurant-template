import { afterAll, describe, expect, inject, test } from "vitest";
import { ForbiddenError } from "../src/auth/session";
import { closePools } from "../src/db/context";
import { QrInputError, QrNotFoundError, createQrSource, getQrSource, listQrSources, renameQrSource, setQrActive } from "../src/db/qr-admin";
import { isValidSlug } from "../src/lib/qr";
import { admin, closeFixtures, makeOrder, makeUser } from "./helpers/fixtures";

const urls = inject("dbUrls");
const o = { url: urls.app };
afterAll(async () => {
  await closePools();
  await closeFixtures();
});
const audit = async (action: string, target: string) => (await admin().query(`select actor_role from audit_log where action = $1 and target_id = $2`, [action, target])).rows.map((r) => r.actor_role);
const NONE = "00000000-0000-4000-8000-000000000000";

describe("managing QR sources", () => {
  test("a manager makes one: the label is trimmed, the slug is made for them, and it is recorded", async () => {
    const { ctx } = await makeUser("manager");
    const made = await createQrSource(ctx, "  Lekki flyer  ", o);
    expect(isValidSlug(made.slug)).toBe(true);
    const got = await getQrSource(ctx, made.id, "all", o);
    expect(got).toMatchObject({ id: made.id, slug: made.slug, label: "Lekki flyer", active: true, scans: 0, orders: 0, revenueMinor: 0 });
    expect(await audit("qr.created", made.slug)).toEqual(["manager"]);
  });

  test("two sources never share a slug", async () => {
    const { ctx } = await makeUser("owner");
    const slugs = new Set((await Promise.all(Array.from({ length: 20 }, () => createQrSource(ctx, "Batch", o)))).map((s) => s.slug));
    expect(slugs.size).toBe(20);
  });

  test("a label must be 1 to 120 characters once trimmed", async () => {
    const { ctx } = await makeUser("manager");
    for (const label of ["", "   ", "x".repeat(121)]) await expect(createQrSource(ctx, label, o), JSON.stringify(label.slice(0, 5))).rejects.toBeInstanceOf(QrInputError);
    await expect(renameQrSource(ctx, (await createQrSource(ctx, "Ok", o)).id, " ", o)).rejects.toBeInstanceOf(QrInputError);
  });

  test("renaming changes the label and never the slug, and is recorded", async () => {
    const { ctx } = await makeUser("owner");
    const made = await createQrSource(ctx, "Old name", o);
    await renameQrSource(ctx, made.id, "New name", o);
    expect(await getQrSource(ctx, made.id, "all", o)).toMatchObject({ label: "New name", slug: made.slug });
    expect(await audit("qr.renamed", made.slug)).toEqual(["owner"]);
  });

  test("switching off and on is recorded, and the source is never deleted", async () => {
    const { ctx } = await makeUser("manager");
    const made = await createQrSource(ctx, "Poster", o);
    await setQrActive(ctx, made.id, false, o);
    expect((await getQrSource(ctx, made.id, "all", o))?.active).toBe(false);
    await setQrActive(ctx, made.id, true, o);
    expect((await getQrSource(ctx, made.id, "all", o))?.active).toBe(true);
    expect(await audit("qr.deactivated", made.slug)).toEqual(["manager"]);
    expect(await audit("qr.activated", made.slug)).toEqual(["manager"]);
  });

  test("an unknown id is not found", async () => {
    const { ctx } = await makeUser("manager");
    expect(await getQrSource(ctx, NONE, "all", o)).toBeNull();
    await expect(renameQrSource(ctx, NONE, "x", o)).rejects.toBeInstanceOf(QrNotFoundError);
    await expect(setQrActive(ctx, NONE, false, o)).rejects.toBeInstanceOf(QrNotFoundError);
  });

  test("kitchen and customers cannot do any of it", async () => {
    const owner = (await makeUser("owner")).ctx;
    const made = await createQrSource(owner, "Private", o);
    for (const role of ["kitchen", "customer"] as const) {
      const { ctx } = await makeUser(role);
      await expect(listQrSources(ctx, "all", o), role).rejects.toBeInstanceOf(ForbiddenError);
      await expect(getQrSource(ctx, made.id, "all", o), role).rejects.toBeInstanceOf(ForbiddenError);
      await expect(createQrSource(ctx, "x", o), role).rejects.toBeInstanceOf(ForbiddenError);
      await expect(renameQrSource(ctx, made.id, "x", o), role).rejects.toBeInstanceOf(ForbiddenError);
      await expect(setQrActive(ctx, made.id, false, o), role).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});

describe("the report", () => {
  async function order(sourceId: string, status: "completed" | "paid" | "cancelled" | "placed" | "refunded", totalMinor: number, daysAgo = 0) {
    const c = await makeUser("customer");
    const { orderId } = await makeOrder(c.userId, status);
    await admin().query(`update orders set source_id = $2, total_minor = $3, placed_at = now() - ($4 || ' days')::interval where id = $1`, [orderId, sourceId, totalMinor, String(daysAgo)]);
    if (status !== "placed" && status !== "cancelled") {
      await admin().query(`insert into payments (order_id, provider, reference, amount_minor, currency, status) values ($1, 'mock', $2, $3, 'NGN', $4)`, [orderId, `pay-${orderId}`, totalMinor, status === "refunded" ? "refunded" : "succeeded"]);
    }
  }
  const scan = (sourceId: string, daysAgo = 0) => admin().query(`insert into qr_scans (source_id, scanned_at) values ($1, now() - ($2 || ' days')::interval)`, [sourceId, String(daysAgo)]);

  test("counts scans, paid orders and the value of completed orders", async () => {
    const { ctx } = await makeUser("manager");
    const s = await createQrSource(ctx, "Report test", o);
    for (let i = 0; i < 5; i++) await scan(s.id);
    await order(s.id, "completed", 300_000);
    await order(s.id, "completed", 200_000);
    await order(s.id, "paid", 150_000); // an order, not yet revenue
    await order(s.id, "refunded", 400_000); // an order, never revenue
    await order(s.id, "cancelled", 999_999); // never paid
    await order(s.id, "placed", 999_999); // not paid yet
    expect(await getQrSource(ctx, s.id, "all", o)).toMatchObject({ scans: 5, orders: 4, revenueMinor: 500_000 });
  });

  test("the date window only counts what happened inside it", async () => {
    const { ctx } = await makeUser("manager");
    const s = await createQrSource(ctx, "Window test", o);
    await scan(s.id, 1);
    await scan(s.id, 20);
    await scan(s.id, 60);
    await scan(s.id, 200);
    await order(s.id, "completed", 100_000, 3);
    await order(s.id, "completed", 100_000, 45);
    const at = async (range: 7 | 30 | 90 | "all") => (await getQrSource(ctx, s.id, range, o))!;
    expect(await at(7)).toMatchObject({ scans: 1, orders: 1, revenueMinor: 100_000 });
    expect(await at(30)).toMatchObject({ scans: 2, orders: 1, revenueMinor: 100_000 });
    expect(await at(90)).toMatchObject({ scans: 3, orders: 2, revenueMinor: 200_000 });
    expect(await at("all")).toMatchObject({ scans: 4, orders: 2, revenueMinor: 200_000 });
  });

  test("the list is newest first and each source gets its own numbers", async () => {
    const { ctx } = await makeUser("owner");
    const a = await createQrSource(ctx, "List A", o);
    const b = await createQrSource(ctx, "List B", o);
    await scan(a.id);
    await scan(a.id);
    await scan(b.id);
    const list = await listQrSources(ctx, "all", o);
    const mine = list.filter((s) => s.id === a.id || s.id === b.id);
    expect(mine.map((s) => s.label)).toEqual(["List B", "List A"]);
    expect(mine.map((s) => s.scans)).toEqual([1, 2]);
  });
});
