import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, inject, test } from "vitest";
import { createAuth } from "../src/auth/auth";
import { account, user } from "../src/db/schema/auth";

const urls = inject("dbUrls");
const pool = new Pool({ connectionString: urls.system, max: 2 });
const db = drizzle(pool);

const auth = createAuth({
  databaseUrl: urls.system,
  secret: "test-secret-that-is-at-least-32-characters",
  baseURL: "http://localhost:3000",
});

const email = `alice+${Date.now()}@example.com`;
const password = "correct horse battery staple";

beforeAll(async () => {
  await auth.api.signUpEmail({ body: { name: "Alice", email, password } });
});
afterAll(async () => {
  await pool.end();
});

describe("Better Auth foundation", () => {
  test("signUpEmail stores a password hash, never the plain text", async () => {
    const [u] = await db.select().from(user).where(eq(user.email, email));
    expect(u).toBeDefined();
    const [a] = await db.select().from(account).where(eq(account.userId, u.id));
    expect(a.password).toBeTruthy();
    expect(a.password).not.toContain(password);
    expect(a.password).not.toBe(password);
  });

  test("user ids are UUIDs", async () => {
    const [u] = await db.select().from(user).where(eq(user.email, email));
    expect(u.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  test("a duplicate email is rejected", async () => {
    await expect(auth.api.signUpEmail({ body: { name: "Alice 2", email, password } })).rejects.toThrow();
  });

  test("sign-in with the right password returns the user", async () => {
    const res = await auth.api.signInEmail({ body: { email, password } });
    expect(res.user.email).toBe(email);
  });

  test("sign-in with the wrong password is rejected", async () => {
    await expect(auth.api.signInEmail({ body: { email, password: "wrong password!!" } })).rejects.toThrow();
  });
});
