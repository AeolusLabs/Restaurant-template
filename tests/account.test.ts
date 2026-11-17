import { afterAll, describe, expect, inject, test } from "vitest";
import { restaurantConfig } from "../config/restaurant";
import { createAuth } from "../src/auth/auth";
import { signUpCustomer } from "../src/auth/signup";
import { ActiveOrderError, deleteCustomerAccount } from "../src/account/delete";
import { exportCustomerData } from "../src/account/export";
import { setMarketingConsent, updateProfile } from "../src/account/profile";
import { closePools } from "../src/db/context";
import { safeNext } from "../src/lib/safe-redirect";
import { admin, closeFixtures, makeOrder, makeUser } from "./helpers/fixtures";

const urls = inject("dbUrls");
const auth = createAuth({ databaseUrl: urls.system, secret: "test-secret-that-is-at-least-32-characters", baseURL: "http://localhost:3000" });
const deps = { auth, appUrl: urls.app, systemUrl: urls.system };
const version = restaurantConfig.legal.policyVersion;

afterAll(async () => {
  await closePools();
  await closeFixtures();
});

/** A real Better Auth user with a profile and consents, plus a way to read what is left of them. */
async function realCustomer(tag: string) {
  const email = `${tag}+${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const { userId } = await signUpCustomer({ email, password: "correct horse battery", name: "Ada Lovelace", consent: { terms: true, privacy: true, marketing: true } }, { auth, systemUrl: urls.system });
  return { email, userId, ctx: { userId, role: "customer" as const } };
}
const count = async (sql: string, params: unknown[]) => (await admin().query(sql, params)).rowCount;

async function withOrderDetail(userId: string, status: "placed" | "paid" | "completed" = "completed") {
  const { orderId } = await makeOrder(userId, status);
  await admin().query(`update orders set notes = 'ring the bell' where id = $1`, [orderId]);
  await admin().query(`insert into order_contacts (order_id, phone, address_snapshot) values ($1, '+2348031112222', '{"line1":"1 Home St"}')`, [orderId]);
  await admin().query(`insert into order_items (order_id, name_snapshot, unit_price_minor_snapshot, quantity, line_total_minor) values ($1, 'Burger', 100000, 1, 100000)`, [orderId]);
  const reference = `ref-${orderId}`;
  await admin().query(`insert into payments (order_id, provider, reference, amount_minor, currency, status) values ($1, 'mock', $2, 100000, 'NGN', 'succeeded')`, [orderId, reference]);
  await admin().query(`insert into webhook_events (provider, event_id, event_type, payload) values ('mock', $1, 'charge.success', $2)`, [
    `evt-${orderId}`,
    JSON.stringify({ event: "charge.success", data: { reference, customer: { email: "ada@example.com" } } }),
  ]);
  return { orderId, reference };
}

describe("safeNext", () => {
  test("keeps same-site paths and sends everything else home", () => {
    expect(safeNext("/orders/ABC234")).toBe("/orders/ABC234");
    expect(safeNext("/checkout?x=1")).toBe("/checkout?x=1");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "orders", "", undefined, null, "/ok\r\nSet-Cookie: x=1"]) {
      expect(safeNext(bad as string | null | undefined), String(bad)).toBe("/");
    }
  });
});

describe("exportCustomerData", () => {
  test("returns the customer's own data, in plain readable fields, and nobody else's", async () => {
    const me = await realCustomer("export");
    const other = await realCustomer("other");
    const mine = await withOrderDetail(me.userId);
    const theirs = await withOrderDetail(other.userId);
    await admin().query(`insert into addresses (profile_id, label, line1, city) values ($1, 'Home', '1 Home St', 'Lagos')`, [me.userId]);
    await admin().query(`insert into order_events (order_id, from_status, to_status, actor_type) values ($1, 'placed', 'paid', 'system')`, [mine.orderId]);

    const data = await exportCustomerData(me.ctx, { email: me.email }, deps);
    expect(data.account).toMatchObject({ email: me.email, fullName: "Ada Lovelace" });
    expect(data.addresses).toEqual([{ label: "Home", line1: "1 Home St", area: null, city: "Lagos" }]);
    expect(data.consents.map((c) => c.type).sort()).toEqual(["marketing", "privacy", "terms"]);
    expect(data.orders).toHaveLength(1);
    expect(data.orders[0]).toMatchObject({ status: "completed", phone: "+2348031112222", notes: "ring the bell", totalMinor: 100_000 });
    expect(data.orders[0].items).toEqual([{ name: "Burger", quantity: 1, unitPriceMinor: 100_000, lineTotalMinor: 100_000, modifiers: [] }]);
    expect(data.orders[0].events).toEqual([expect.objectContaining({ from: "placed", to: "paid" })]);
    expect(data.orders[0].payments).toEqual([expect.objectContaining({ reference: mine.reference, status: "succeeded", amountMinor: 100_000 })]);

    const json = JSON.stringify(data);
    expect(json).not.toContain(theirs.reference);
    expect(json).not.toContain(other.email);
    expect(json).not.toMatch(/password|"token"|secret|hash/i);
    expect(json).not.toContain(me.userId); // no internal ids
  });

  test("records the export in data_requests as completed", async () => {
    const me = await realCustomer("exportlog");
    await exportCustomerData(me.ctx, { email: me.email }, deps);
    const rows = (await admin().query(`select kind, status, completed_at from data_requests where profile_id = $1`, [me.userId])).rows;
    expect(rows).toEqual([{ kind: "export", status: "completed", completed_at: expect.any(Date) }]);
  });
});

describe("deleteCustomerAccount", () => {
  test("removes the account and its personal data, and keeps the orders as anonymous financial records", async () => {
    const me = await realCustomer("del");
    const other = await realCustomer("delother");
    const done = await withOrderDetail(me.userId, "completed");
    await admin().query(`insert into addresses (profile_id, label, line1, city) values ($1, 'Home', '1 Home St', 'Lagos')`, [me.userId]);
    const otherOrder = await withOrderDetail(other.userId, "completed");

    await deleteCustomerAccount(me.ctx, deps);

    expect(await count(`select 1 from "user" where id = $1`, [me.userId])).toBe(0);
    expect(await count(`select 1 from account where user_id = $1`, [me.userId])).toBe(0);
    expect(await count(`select 1 from profiles where id = $1`, [me.userId])).toBe(0);
    expect(await count(`select 1 from consents where profile_id = $1`, [me.userId])).toBe(0);
    expect(await count(`select 1 from addresses where profile_id = $1`, [me.userId])).toBe(0);

    const order = (await admin().query(`select profile_id, customer_name, notes, total_minor::int as total, status from orders where id = $1`, [done.orderId])).rows[0];
    expect(order).toEqual({ profile_id: null, customer_name: "Deleted customer", notes: null, total: 100_000, status: "completed" });
    const contact = (await admin().query(`select phone, address_snapshot from order_contacts where order_id = $1`, [done.orderId])).rows[0];
    expect(contact).toEqual({ phone: "", address_snapshot: {} });
    expect(await count(`select 1 from order_items where order_id = $1`, [done.orderId])).toBe(1);
    expect(await count(`select 1 from payments where order_id = $1`, [done.orderId])).toBe(1);

    // The provider's stored webhook payload carried the customer's email, so it is blanked.
    const payload = (await admin().query(`select payload from webhook_events where event_id = $1`, [`evt-${done.orderId}`])).rows[0].payload;
    expect(payload).toEqual({ redacted: true });

    expect((await admin().query(`select kind, status from data_requests where profile_id is null and kind = 'delete' order by requested_at desc limit 1`)).rows[0]).toEqual({ kind: "delete", status: "completed" });
    expect(await count(`select 1 from audit_log where action = 'account.deleted' and target_id = $1`, [me.userId])).toBe(1);

    // Another customer is untouched.
    expect(await count(`select 1 from "user" where id = $1`, [other.userId])).toBe(1);
    expect((await admin().query(`select customer_name from orders where id = $1`, [otherOrder.orderId])).rows[0].customer_name).toBe("Test customer");
    expect((await admin().query(`select payload from webhook_events where event_id = $1`, [`evt-${otherOrder.orderId}`])).rows[0].payload.event).toBe("charge.success");
  });

  test("cancels an order that was never paid, so nothing is left waiting on someone who is gone", async () => {
    const me = await realCustomer("delplaced");
    const { orderId } = await makeOrder(me.userId, "placed");
    await deleteCustomerAccount(me.ctx, deps);
    expect((await admin().query(`select status from orders where id = $1`, [orderId])).rows[0].status).toBe("cancelled");
    expect(await count(`select 1 from order_events where order_id = $1 and reason = 'account deleted'`, [orderId])).toBe(1);
  });

  test("refuses while a paid order is still in progress, and changes nothing", async () => {
    const me = await realCustomer("delbusy");
    const { orderId } = await withOrderDetail(me.userId, "paid");
    await expect(deleteCustomerAccount(me.ctx, deps)).rejects.toBeInstanceOf(ActiveOrderError);
    expect(await count(`select 1 from "user" where id = $1`, [me.userId])).toBe(1);
    expect((await admin().query(`select customer_name from orders where id = $1`, [orderId])).rows[0].customer_name).toBe("Test customer");
    expect(await count(`select 1 from data_requests where profile_id = $1 and kind = 'delete'`, [me.userId])).toBe(0);
  });

  test("is not available to staff accounts", async () => {
    const staff = await makeUser("manager");
    await expect(deleteCustomerAccount(staff.ctx, deps)).rejects.toThrow(/customer/i);
  });
});

describe("setMarketingConsent", () => {
  test("withdraws marketing consent without touching terms or privacy, and can grant it again", async () => {
    const me = await realCustomer("consent");
    await setMarketingConsent(me.ctx, false, { appUrl: urls.app });
    const state = async () => (await admin().query(`select type, withdrawn_at is not null as withdrawn from consents where profile_id = $1 order by type::text, granted_at`, [me.userId])).rows;
    expect(await state()).toEqual([
      { type: "marketing", withdrawn: true },
      { type: "privacy", withdrawn: false },
      { type: "terms", withdrawn: false },
    ]);
    await setMarketingConsent(me.ctx, true, { appUrl: urls.app });
    await setMarketingConsent(me.ctx, true, { appUrl: urls.app }); // a repeat adds nothing
    expect((await state()).filter((r) => r.type === "marketing")).toEqual([
      { type: "marketing", withdrawn: true },
      { type: "marketing", withdrawn: false },
    ]);
    expect((await admin().query(`select policy_version from consents where profile_id = $1 and type = 'marketing' order by granted_at desc limit 1`, [me.userId])).rows[0].policy_version).toBe(version);
  });
});

describe("updateProfile", () => {
  test("a rejected field is named, so the form can show the message next to it", async () => {
    const me = await realCustomer("profilepath");
    const phoneErr = await updateProfile(me.ctx, { fullName: "Ada", phone: "call me" }, { appUrl: urls.app }).catch((e) => e);
    expect(phoneErr.issues.map((i: { path: unknown[] }) => i.path[0])).toEqual(["phone"]);
    const nameErr = await updateProfile(me.ctx, { fullName: " ", phone: null }, { appUrl: urls.app }).catch((e) => e);
    expect(nameErr.issues.map((i: { path: unknown[] }) => i.path[0])).toEqual(["fullName"]);
  });

  test("changes the caller's own name and phone", async () => {
    const me = await realCustomer("profile");
    await updateProfile(me.ctx, { fullName: "  Ada King  ", phone: "0803 111 2222" }, { appUrl: urls.app });
    expect((await admin().query(`select full_name, phone from profiles where id = $1`, [me.userId])).rows[0]).toEqual({ full_name: "Ada King", phone: "0803 111 2222" });
    await updateProfile(me.ctx, { fullName: "Ada King", phone: "" }, { appUrl: urls.app });
    expect((await admin().query(`select phone from profiles where id = $1`, [me.userId])).rows[0].phone).toBeNull();
  });

  test("rejects an empty name and a phone that is not a phone number", async () => {
    const me = await realCustomer("profilebad");
    await expect(updateProfile(me.ctx, { fullName: "  ", phone: null }, { appUrl: urls.app })).rejects.toThrow();
    await expect(updateProfile(me.ctx, { fullName: "Ada", phone: "call me" }, { appUrl: urls.app })).rejects.toThrow();
  });
});
