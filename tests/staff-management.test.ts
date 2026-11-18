import { afterAll, describe, expect, inject, test } from "vitest";
import { createAuth } from "../src/auth/auth";
import { ForbiddenError, getRequestContext } from "../src/auth/session";
import { signUpCustomer } from "../src/auth/signup";
import { blockStaff, changeStaffRole, createStaffUser, listStaff, sendStaffPasswordReset, unblockStaff } from "../src/auth/staff";
import { closePools, type RequestContext } from "../src/db/context";
import type { AppRole } from "../src/domain/roles";
import { MockEmailProvider } from "../src/providers/email/mock";
import { admin, closeFixtures } from "./helpers/fixtures";

const urls = inject("dbUrls");
const email = new MockEmailProvider();
const auth = createAuth({ databaseUrl: urls.system, secret: "test-secret-that-is-at-least-32-characters", baseURL: "http://localhost:3000", email });
const deps = { auth, systemUrl: urls.system, appUrl: urls.app };
const password = "correct horse battery";
const stamp = Date.now();

type Account = { userId: string; address: string; ctx: RequestContext };
let n = 0;
async function account(role: AppRole): Promise<Account> {
  const address = `staffm${++n}-${role}+${stamp}@example.com`;
  const { userId } = await signUpCustomer({ email: address, password, name: `${role} ${n}`, consent: { terms: true, privacy: true } }, deps);
  if (role !== "customer") await admin().query(`update profiles set role = $1 where id = $2`, [role, userId]);
  return { userId, address, ctx: { userId, role } };
}
async function cookieFor(address: string): Promise<Headers> {
  const { headers } = await auth.api.signInEmail({ body: { email: address, password }, returnHeaders: true });
  return new Headers({ cookie: headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") });
}
const audits = async (action: string, target: string) => (await admin().query(`select actor_role from audit_log where action = $1 and target_id = $2`, [action, target])).rows;

afterAll(async () => {
  await closePools();
  await closeFixtures();
});

describe("listStaff", () => {
  test("owners and managers see every staff member with their email and state, and no customers", async () => {
    const [owner, manager, kitchen, customer] = [await account("owner"), await account("manager"), await account("kitchen"), await account("customer")];
    await admin().query(`update profiles set blocked_at = now() where id = $1`, [kitchen.userId]);
    for (const viewer of [owner, manager]) {
      const list = await listStaff(viewer.ctx, deps);
      const byId = new Map(list.map((s) => [s.id, s]));
      expect(byId.get(owner.userId)).toMatchObject({ email: owner.address, role: "owner", blocked: false });
      expect(byId.get(kitchen.userId)).toMatchObject({ role: "kitchen", blocked: true });
      expect(byId.has(customer.userId)).toBe(false);
    }
  });

  test("the kitchen and customers cannot list staff", async () => {
    for (const role of ["kitchen", "customer"] as const) {
      await expect(listStaff((await account(role)).ctx, deps)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  test("no password data or tokens appear in the result", async () => {
    const owner = await account("owner");
    expect(JSON.stringify(await listStaff(owner.ctx, deps))).not.toMatch(/password|hash|token|secret/i);
  });
});

describe("changeStaffRole", () => {
  test("an owner changes a staff member's role, and it is audited", async () => {
    const [owner, kitchen] = [await account("owner"), await account("kitchen")];
    await changeStaffRole(owner.ctx, kitchen.userId, "manager", deps);
    expect((await admin().query(`select role from profiles where id = $1`, [kitchen.userId])).rows[0].role).toBe("manager");
    expect(await audits("profile.role", kitchen.userId)).toEqual([{ actor_role: "owner" }]);
  });

  test("a manager cannot, and an owner cannot change their own role", async () => {
    const [owner, manager, kitchen] = [await account("owner"), await account("manager"), await account("kitchen")];
    await expect(changeStaffRole(manager.ctx, kitchen.userId, "manager", deps)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(changeStaffRole(owner.ctx, owner.userId, "kitchen", deps)).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("it only applies to staff: a customer cannot be promoted this way, and no one can be made a customer", async () => {
    const [owner, customer, kitchen] = [await account("owner"), await account("customer"), await account("kitchen")];
    await expect(changeStaffRole(owner.ctx, customer.userId, "manager", deps)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(changeStaffRole(owner.ctx, kitchen.userId, "customer" as never, deps)).rejects.toThrow();
    expect((await admin().query(`select role from profiles where id = $1`, [kitchen.userId])).rows[0].role).toBe("kitchen");
  });
});

describe("blocking staff", () => {
  test("an owner blocks a staff member: their session stops working, and unblocking restores it", async () => {
    const [owner, kitchen] = [await account("owner"), await account("kitchen")];
    const headers = await cookieFor(kitchen.address);
    expect(await getRequestContext(headers, deps)).toMatchObject({ role: "kitchen" });
    await blockStaff(owner.ctx, kitchen.userId, deps);
    expect(await getRequestContext(headers, deps)).toBeNull();
    await unblockStaff(owner.ctx, kitchen.userId, deps);
    expect(await getRequestContext(headers, deps)).toMatchObject({ role: "kitchen" });
    expect((await audits("profile.block", kitchen.userId)).length).toBe(1);
  });

  test("a manager cannot block staff, and nobody can block themselves", async () => {
    const [owner, manager, kitchen] = [await account("owner"), await account("manager"), await account("kitchen")];
    await expect(blockStaff(manager.ctx, kitchen.userId, deps)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(blockStaff(owner.ctx, owner.userId, deps)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("sendStaffPasswordReset", () => {
  test("an owner sends a staff member a reset link by email, and it is audited", async () => {
    const [owner, kitchen] = [await account("owner"), await account("kitchen")];
    email.outbox.length = 0;
    await sendStaffPasswordReset(owner.ctx, kitchen.userId, deps);
    expect(email.outbox).toHaveLength(1);
    expect(email.outbox[0].to).toBe(kitchen.address);
    expect(await audits("staff.password_reset_sent", kitchen.userId)).toEqual([{ actor_role: "owner" }]);
  });

  test("a manager cannot, and it will not send one for a customer", async () => {
    const [owner, manager, kitchen, customer] = [await account("owner"), await account("manager"), await account("kitchen"), await account("customer")];
    await expect(sendStaffPasswordReset(manager.ctx, kitchen.userId, deps)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(sendStaffPasswordReset(owner.ctx, customer.userId, deps)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("createStaffUser does not sign anyone in", () => {
  test("no session is started for the new account, so the owner's own session is never replaced", async () => {
    const owner = await account("owner");
    const address = `nosession+${stamp}@example.com`;
    const { userId } = await createStaffUser(owner.ctx, { email: address, name: "No Session", role: "manager", temporaryPassword: "temporary pass 2" }, deps);
    expect((await admin().query(`select 1 from session where user_id = $1`, [userId])).rowCount).toBe(0);
  });

  test("an email that already has an account is refused, and nothing is created", async () => {
    const owner = await account("owner");
    const existing = await account("customer");
    await expect(createStaffUser(owner.ctx, { email: existing.address, name: "Dupe", role: "kitchen", temporaryPassword: "temporary pass 3" }, deps)).rejects.toThrow(/already/i);
    expect((await admin().query(`select count(*)::int as n from "user" where email = $1`, [existing.address])).rows[0].n).toBe(1);
  });
});

describe("createStaffUser, as used by the screen", () => {
  test("creates the account with the chosen role and a temporary password that works", async () => {
    const owner = await account("owner");
    const address = `newhire+${stamp}@example.com`;
    const { userId } = await createStaffUser(owner.ctx, { email: address, name: "New Hire", role: "kitchen", temporaryPassword: "temporary pass 1" }, deps);
    expect((await admin().query(`select role from profiles where id = $1`, [userId])).rows[0].role).toBe("kitchen");
    expect((await auth.api.signInEmail({ body: { email: address, password: "temporary pass 1" } })).user.email).toBe(address);
  });
});
