import { afterAll, describe, expect, inject, test } from "vitest";
import { buildResetEmail } from "../src/auth/reset-email";
import { createAuth } from "../src/auth/auth";
import { signUpCustomer } from "../src/auth/signup";
import { closePools } from "../src/db/context";
import { MockEmailProvider } from "../src/providers/email/mock";
import { admin, closeFixtures } from "./helpers/fixtures";

const urls = inject("dbUrls");
const BASE = "http://localhost:3000";
const OLD = "old password 123";
const NEW = "brand new password 456";

const email = new MockEmailProvider();
const auth = createAuth({ databaseUrl: urls.system, secret: "test-secret-that-is-at-least-32-characters", baseURL: BASE, email, appName: "Sample Kitchen" });

afterAll(async () => {
  await closePools();
  await closeFixtures();
});

let n = 0;
async function customer() {
  const address = `reset${++n}+${Date.now()}@example.com`;
  const { userId } = await signUpCustomer({ email: address, password: OLD, name: "Ada Lovelace", consent: { terms: true, privacy: true } }, { auth, systemUrl: urls.system });
  return { address, userId };
}
const request = (address: string) => auth.api.requestPasswordReset({ body: { email: address, redirectTo: "/reset-password" } });
const tokenFrom = (text: string): string => /\/reset-password\/([A-Za-z0-9]+)\?/.exec(text)![1];
const signIn = (address: string, password: string) => auth.api.signInEmail({ body: { email: address, password } });

describe("requesting a reset", () => {
  test("emails the account holder one link, and nothing else leaves the server", async () => {
    const { address } = await customer();
    email.outbox.length = 0;
    await request(address);
    expect(email.outbox).toHaveLength(1);
    const mail = email.outbox[0];
    expect(mail.to).toBe(address);
    expect(mail.subject).toMatch(/reset/i);
    expect(mail.text).toContain(`${BASE}/api/auth/reset-password/`);
    expect(mail.text).toContain("callbackURL=%2Freset-password");
    expect(mail.text).not.toContain(OLD);
  });

  test("an address with no account gets the same answer and no email, so accounts cannot be probed", async () => {
    const real = await customer();
    email.outbox.length = 0;
    const known = await request(real.address);
    const unknown = await request(`nobody+${Date.now()}@example.com`);
    expect(unknown).toEqual(known);
    expect(email.outbox).toHaveLength(1);
    expect(email.outbox[0].to).toBe(real.address);
  });

  test("the email is plain text that names the restaurant, says when the link expires, and says to ignore it if unwanted", () => {
    const mail = buildResetEmail({ name: "Ada", url: "https://shop.example/api/auth/reset-password/abc?callbackURL=%2Freset-password", appName: "Sample Kitchen" });
    expect(mail.subject).toBe("Reset your Sample Kitchen password");
    expect(mail.text).toContain("Ada");
    expect(mail.text).toContain("https://shop.example/api/auth/reset-password/abc?callbackURL=%2Freset-password");
    expect(mail.text).toMatch(/1 hour/);
    expect(mail.text).toMatch(/ignore this email/i);
    expect(mail.text).not.toMatch(/<[a-z]/i);
  });
});

describe("resetting the password", () => {
  async function requested() {
    const c = await customer();
    email.outbox.length = 0;
    await request(c.address);
    return { ...c, token: tokenFrom(email.outbox[0].text) };
  }

  test("the new password works, the old one stops working", async () => {
    const { address, token } = await requested();
    await auth.api.resetPassword({ body: { newPassword: NEW, token } });
    expect((await signIn(address, NEW)).user.email).toBe(address);
    await expect(signIn(address, OLD)).rejects.toThrow();
  });

  test("a link works once", async () => {
    const { token } = await requested();
    await auth.api.resetPassword({ body: { newPassword: NEW, token } });
    await expect(auth.api.resetPassword({ body: { newPassword: "another password 789", token } })).rejects.toThrow();
  });

  test("a link stops working after an hour", async () => {
    const { address, token } = await requested();
    await admin().query(`update verification set expires_at = now() - interval '1 minute' where identifier = $1`, [`reset-password:${token}`]);
    await expect(auth.api.resetPassword({ body: { newPassword: NEW, token } })).rejects.toThrow();
    expect((await signIn(address, OLD)).user.email).toBe(address);
  });

  test("a made-up token is refused", async () => {
    await expect(auth.api.resetPassword({ body: { newPassword: NEW, token: "notarealtoken" } })).rejects.toThrow();
  });

  test("a too-short password is refused and does not spend the link", async () => {
    const { address, token } = await requested();
    await expect(auth.api.resetPassword({ body: { newPassword: "short", token } })).rejects.toThrow();
    await auth.api.resetPassword({ body: { newPassword: NEW, token } });
    expect((await signIn(address, NEW)).user.email).toBe(address);
  });

  test("everyone already signed in on this account is signed out", async () => {
    const { address, userId, token } = await requested();
    await signIn(address, OLD);
    await signIn(address, OLD);
    expect((await admin().query(`select 1 from session where user_id = $1`, [userId])).rowCount).toBe(3); // sign-up started one, plus two sign-ins
    await auth.api.resetPassword({ body: { newPassword: NEW, token } });
    expect((await admin().query(`select 1 from session where user_id = $1`, [userId])).rowCount).toBe(0);
  });
});
