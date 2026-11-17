import { afterAll, beforeAll, describe, expect, inject, test } from "vitest";
import { createAuth } from "../src/auth/auth";
import { ForbiddenError, UnauthenticatedError, getRequestContext, requireRole } from "../src/auth/session";
import { signUpCustomer } from "../src/auth/signup";
import { blockCustomer, createStaffUser, unblockCustomer } from "../src/auth/staff";
import { closePools, type RequestContext } from "../src/db/context";
import type { AppRole } from "../src/domain/roles";
import { admin, closeFixtures } from "./helpers/fixtures";

const urls = inject("dbUrls");
const auth = createAuth({
  databaseUrl: urls.system,
  secret: "test-secret-that-is-at-least-32-characters",
  baseURL: "http://localhost:3000",
});
const deps = { auth, systemUrl: urls.system, appUrl: urls.app };
const password = "correct horse battery";
const stamp = Date.now();

type Account = { userId: string; email: string; ctx: RequestContext };
async function account(role: AppRole, tag: string): Promise<Account> {
  const email = `${tag}-${role}+${stamp}@example.com`;
  const { userId } = await signUpCustomer({ email, password, name: tag, consent: { terms: true, privacy: true } }, deps);
  if (role !== "customer") await admin().query(`update profiles set role = $1 where id = $2`, [role, userId]);
  return { userId, email, ctx: { userId, role } };
}

async function cookieFor(email: string): Promise<Headers> {
  const { headers } = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
  const cookie = headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return new Headers({ cookie });
}

let owner: Account, manager: Account, kitchen: Account, customer: Account, customer2: Account;

beforeAll(async () => {
  [owner, manager, kitchen, customer, customer2] = await Promise.all([
    account("owner", "o"),
    account("manager", "m"),
    account("kitchen", "k"),
    account("customer", "c1"),
    account("customer", "c2"),
  ]);
});
afterAll(async () => {
  await closePools();
  await closeFixtures();
});

describe("getRequestContext", () => {
  test("no session returns a null context", async () => {
    expect(await getRequestContext(new Headers(), deps)).toBeNull();
    expect(await getRequestContext(new Headers({ cookie: "better-auth.session_token=garbage" }), deps)).toBeNull();
  });

  test("a valid session returns the user's id and role from their profile", async () => {
    expect(await getRequestContext(await cookieFor(manager.email), deps)).toEqual(manager.ctx);
    expect(await getRequestContext(await cookieFor(customer.email), deps)).toEqual(customer.ctx);
  });

  test("a blocked user's session returns a null context, and unblocking restores it", async () => {
    const headers = await cookieFor(customer2.email);
    expect(await getRequestContext(headers, deps)).toEqual(customer2.ctx);
    await admin().query(`update profiles set blocked_at = now() where id = $1`, [customer2.userId]);
    expect(await getRequestContext(headers, deps)).toBeNull();
    await admin().query(`update profiles set blocked_at = null where id = $1`, [customer2.userId]);
    expect(await getRequestContext(headers, deps)).toEqual(customer2.ctx);
  });

  test("a deleted profile's session returns a null context", async () => {
    const gone = await account("customer", "gone");
    const headers = await cookieFor(gone.email);
    await admin().query(`update profiles set deleted_at = now() where id = $1`, [gone.userId]);
    expect(await getRequestContext(headers, deps)).toBeNull();
  });

  test("a user with no profile row returns a null context", async () => {
    const email = `noprofile+${stamp}@example.com`;
    await auth.api.signUpEmail({ body: { email, password, name: "No Profile" } });
    expect(await getRequestContext(await cookieFor(email), deps)).toBeNull();
  });
});

describe("requireRole", () => {
  test("throws UnauthenticatedError for null and ForbiddenError for the wrong role", () => {
    expect(() => requireRole(null, ["owner"])).toThrow(UnauthenticatedError);
    expect(() => requireRole(customer.ctx, ["owner", "manager"])).toThrow(ForbiddenError);
  });
  test("returns the context when the role is allowed", () => {
    expect(requireRole(manager.ctx, ["owner", "manager"])).toBe(manager.ctx);
  });
});

describe("createStaffUser", () => {
  const input = (tag: string, role: "manager" | "kitchen" | "owner" = "kitchen") => ({
    email: `${tag}+${stamp}@example.com`,
    name: tag,
    role,
    temporaryPassword: "temporary password 123",
  });

  test("only an owner can create staff; manager, kitchen and customer get ForbiddenError", async () => {
    for (const actor of [manager, kitchen, customer]) {
      const i = input(`denied-${actor.ctx.role}`);
      await expect(createStaffUser(actor.ctx, i, deps)).rejects.toBeInstanceOf(ForbiddenError);
      expect((await admin().query(`select 1 from "user" where email = $1`, [i.email])).rowCount).toBe(0);
    }
  });

  test("a created staff member has the requested role, a hashed password, and an audit entry", async () => {
    const i = input("newkitchen");
    const { userId } = await createStaffUser(owner.ctx, i, deps);
    expect((await admin().query(`select role from profiles where id = $1`, [userId])).rows[0].role).toBe("kitchen");
    const pw = (await admin().query(`select password from account where user_id = $1`, [userId])).rows[0].password;
    expect(pw).toBeTruthy();
    expect(pw).not.toContain(i.temporaryPassword);
    const audit = await admin().query(`select actor_id, action, target_id from audit_log where action = 'staff.create' and target_id = $1`, [userId]);
    expect(audit.rows).toEqual([{ actor_id: owner.userId, action: "staff.create", target_id: userId }]);
  });

  test("an owner can create another owner or a manager", async () => {
    const m = await createStaffUser(owner.ctx, input("newmanager", "manager"), deps);
    expect((await admin().query(`select role from profiles where id = $1`, [m.userId])).rows[0].role).toBe("manager");
  });

  test("a duplicate email is rejected and leaves no orphan", async () => {
    const i = input("dupstaff");
    await createStaffUser(owner.ctx, i, deps);
    await expect(createStaffUser(owner.ctx, i, deps)).rejects.toThrow();
    expect((await admin().query(`select count(*)::int as n from "user" where email = $1`, [i.email])).rows[0].n).toBe(1);
  });

  test("an unknown role is rejected before anything is created", async () => {
    const i = { ...input("badrole"), role: "customer" } as unknown as ReturnType<typeof input>;
    await expect(createStaffUser(owner.ctx, i, deps)).rejects.toThrow();
    expect((await admin().query(`select 1 from "user" where email = $1`, [i.email])).rowCount).toBe(0);
  });
});

describe("blocking customers", () => {
  test("blocking a customer writes an audit_log row with the actor and the target", async () => {
    const target = await account("customer", "blockme");
    await blockCustomer(manager.ctx, target.userId, deps);
    expect((await admin().query(`select blocked_at from profiles where id = $1`, [target.userId])).rows[0].blocked_at).not.toBeNull();
    const audit = await admin().query(`select actor_id, actor_role from audit_log where action = 'profile.block' and target_id = $1`, [target.userId]);
    expect(audit.rows).toEqual([{ actor_id: manager.userId, actor_role: "manager" }]);
    await unblockCustomer(manager.ctx, target.userId, deps);
    expect((await admin().query(`select blocked_at from profiles where id = $1`, [target.userId])).rows[0].blocked_at).toBeNull();
  });

  test("a manager cannot block an owner, and a customer or kitchen user cannot block anyone", async () => {
    await expect(blockCustomer(manager.ctx, owner.userId, deps)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(blockCustomer(customer.ctx, customer2.userId, deps)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(blockCustomer(kitchen.ctx, customer2.userId, deps)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await admin().query(`select blocked_at from profiles where id = $1`, [owner.userId])).rows[0].blocked_at).toBeNull();
  });
});
