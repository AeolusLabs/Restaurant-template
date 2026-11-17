import { afterAll, describe, expect, inject, test } from "vitest";
import { ForbiddenError } from "../src/auth/session";
import { listOpenAlerts, resolveAlert } from "../src/db/alerts";
import { closePools } from "../src/db/context";
import { startPayment } from "../src/payments/start-payment";
import { handlePaymentWebhook } from "../src/payments/webhook";
import { MockPaymentProvider, signMockWebhook } from "../src/providers/payment/mock";
import type { PaymentVerification } from "../src/providers/payment/types";
import { admin, closeFixtures, makeOrder, makeUser } from "./helpers/fixtures";

const urls = inject("dbUrls");
const opts = { url: urls.app };
afterAll(async () => {
  await closePools();
  await closeFixtures();
});

class P extends MockPaymentProvider {
  override?: PaymentVerification;
  async verify(reference: string) {
    return this.override ?? super.verify(reference);
  }
}

async function paid(provider: P) {
  const user = await makeUser("customer");
  const { orderId } = await makeOrder(user.userId);
  const code = (await admin().query(`select public_code from orders where id = $1`, [orderId])).rows[0].public_code as string;
  const { reference } = await startPayment(user.ctx, code, { provider, email: "a@example.com", baseUrl: "http://x", appUrl: urls.app, systemUrl: urls.system });
  return { orderId, code, reference, user };
}
async function deliver(provider: P, reference: string) {
  const body = JSON.stringify({ id: `evt-${Math.random()}`, event: "charge.success", data: { reference } });
  return handlePaymentWebhook(body, new Headers({ "x-mock-signature": signMockWebhook(body) }), { provider, systemUrl: urls.system });
}
const alertsFor = async (orderId: string) => (await admin().query(`select id, kind, severity, payload, resolved_at from alerts where order_id = $1`, [orderId])).rows;

describe("payments that cannot be applied raise an alert", () => {
  test("a wrong amount", async () => {
    const p = new P();
    const o = await paid(p);
    p.override = { status: "success", amountMinor: 1_000, currency: "NGN" };
    await deliver(p, o.reference);
    const rows = await alertsFor(o.orderId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "payment_mismatch", severity: "critical", resolved_at: null });
    expect(rows[0].payload).toMatchObject({ reference: o.reference, expectedMinor: 100_000, providerMinor: 1_000 });
  });

  test("money after the order was cancelled", async () => {
    const p = new P();
    const o = await paid(p);
    await admin().query(`update orders set status = 'cancelled' where id = $1`, [o.orderId]);
    p.simulatePayment(o.reference, "success");
    await deliver(p, o.reference);
    expect((await alertsFor(o.orderId)).map((r) => r.kind)).toEqual(["payment_late"]);
  });

  test("a second payment for an order that is already paid", async () => {
    const p = new P();
    const o = await paid(p);
    const second = await startPayment(o.user.ctx, o.code, { provider: p, email: "a@example.com", baseUrl: "http://x", appUrl: urls.app, systemUrl: urls.system });
    p.simulatePayment(o.reference, "success");
    p.simulatePayment(second.reference, "success");
    await deliver(p, o.reference);
    await deliver(p, second.reference);
    const rows = await alertsFor(o.orderId);
    expect(rows.map((r) => r.kind)).toEqual(["payment_duplicate"]);
    expect(rows[0].severity).toBe("warning");
  });

  test("a normal payment raises none", async () => {
    const p = new P();
    const o = await paid(p);
    p.simulatePayment(o.reference, "success");
    await deliver(p, o.reference);
    expect(await alertsFor(o.orderId)).toEqual([]);
  });
});

describe("reading and resolving alerts", () => {
  async function oneAlert() {
    const p = new P();
    const o = await paid(p);
    p.override = { status: "success", amountMinor: 5, currency: "NGN" };
    await deliver(p, o.reference);
    return { ...o, alertId: (await alertsFor(o.orderId))[0].id as string };
  }

  test("managers and owners see open alerts with the order they belong to", async () => {
    const a = await oneAlert();
    for (const role of ["manager", "owner"] as const) {
      const { ctx } = await makeUser(role);
      const found = (await listOpenAlerts(ctx, opts)).find((x) => x.id === a.alertId);
      expect(found, role).toMatchObject({ kind: "payment_mismatch", orderCode: a.code });
    }
  });

  test("the kitchen and customers cannot see them, even through the same function", async () => {
    const a = await oneAlert();
    const kitchen = await makeUser("kitchen");
    const customer = await makeUser("customer");
    await expect(listOpenAlerts(kitchen.ctx, opts)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listOpenAlerts(customer.ctx, opts)).rejects.toBeInstanceOf(ForbiddenError);
    // And the database agrees: a direct query as the kitchen finds nothing.
    const { withRequestContext } = await import("../src/db/context");
    const { sql } = await import("drizzle-orm");
    const rows = await withRequestContext(kitchen.ctx, (tx) => tx.execute(sql`select id from alerts where id = ${a.alertId}::uuid`), opts);
    expect(rows.rows).toEqual([]);
  });

  test("resolving closes it once, records who did it, and leaves a trail in the audit log", async () => {
    const a = await oneAlert();
    const { ctx, userId } = await makeUser("manager");
    expect(await resolveAlert(ctx, a.alertId, opts)).toBe(true);
    expect(await resolveAlert(ctx, a.alertId, opts)).toBe(false);
    const row = (await admin().query(`select resolved_at, resolved_by from alerts where id = $1`, [a.alertId])).rows[0];
    expect(row.resolved_at).not.toBeNull();
    expect(row.resolved_by).toBe(userId);
    expect((await listOpenAlerts(ctx, opts)).some((x) => x.id === a.alertId)).toBe(false);
    expect((await admin().query(`select action from audit_log where target_id = $1`, [a.alertId])).rows).toEqual([{ action: "alert.resolved" }]);
  });

  test("the kitchen cannot resolve one", async () => {
    const a = await oneAlert();
    const { ctx } = await makeUser("kitchen");
    await expect(resolveAlert(ctx, a.alertId, opts)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
