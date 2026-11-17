import { afterAll, describe, expect, inject, test } from "vitest";
import { ConsentRequiredError, signUpCustomer } from "../src/auth/signup";
import { createAuth } from "../src/auth/auth";
import { closePools } from "../src/db/context";
import { restaurantConfig } from "../config/restaurant";
import { admin, closeFixtures } from "./helpers/fixtures";

const urls = inject("dbUrls");
const auth = createAuth({
  databaseUrl: urls.system,
  secret: "test-secret-that-is-at-least-32-characters",
  baseURL: "http://localhost:3000",
});
const deps = { auth, systemUrl: urls.system };
const consent = { terms: true, privacy: true };
const base = (tag: string) => ({ email: `${tag}+${Date.now()}@example.com`, password: "correct horse battery", name: "Ada", consent });

afterAll(async () => {
  await closePools();
  await closeFixtures();
});

const userByEmail = async (email: string) => (await admin().query(`select id from "user" where email = $1`, [email])).rows[0];

describe("signUpCustomer", () => {
  test("creates a customer profile and a consent row for terms and privacy, with the policy version", async () => {
    const input = base("a");
    const { userId } = await signUpCustomer(input, deps);
    const profile = (await admin().query(`select role, full_name from profiles where id = $1`, [userId])).rows[0];
    expect(profile).toEqual({ role: "customer", full_name: "Ada" });
    const consents = (await admin().query(`select type, policy_version from consents where profile_id = $1 order by type::text`, [userId])).rows;
    expect(consents).toEqual([
      { type: "privacy", policy_version: restaurantConfig.legal.policyVersion },
      { type: "terms", policy_version: restaurantConfig.legal.policyVersion },
    ]);
  });

  test("marketing consent is stored only when given", async () => {
    const without = await signUpCustomer(base("b1"), deps);
    const withM = await signUpCustomer({ ...base("b2"), consent: { ...consent, marketing: true } }, deps);
    const types = async (id: string) =>
      (await admin().query(`select type from consents where profile_id = $1 order by type::text`, [id])).rows.map((r) => r.type);
    expect(await types(without.userId)).toEqual(["privacy", "terms"]);
    expect(await types(withM.userId)).toEqual(["marketing", "privacy", "terms"]);
  });

  test("sign-up without terms or privacy consent is rejected and creates no user", async () => {
    for (const bad of [{ terms: false, privacy: true }, { terms: true, privacy: false }, { terms: false, privacy: false }]) {
      const input = { ...base("c"), consent: bad };
      await expect(signUpCustomer(input, deps)).rejects.toBeInstanceOf(ConsentRequiredError);
      expect(await userByEmail(input.email)).toBeUndefined();
    }
  });

  test("a role field in the input is ignored and the profile role is customer", async () => {
    const input = { ...base("d"), role: "owner" } as ReturnType<typeof base>;
    const { userId } = await signUpCustomer(input, deps);
    expect((await admin().query(`select role from profiles where id = $1`, [userId])).rows[0].role).toBe("customer");
  });

  test("calling the public Better Auth sign-up route directly does not create a user", async () => {
    const email = `direct+${Date.now()}@example.com`;
    const res = await auth.handler(
      new Request("http://localhost:3000/api/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost:3000" },
        body: JSON.stringify({ email, password: "correct horse battery", name: "Mallory", role: "owner" }),
      }),
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await userByEmail(email)).toBeUndefined();
  });

  test("a failure after the user insert leaves no user behind", async () => {
    const input = base("e");
    await expect(signUpCustomer(input, { auth, systemUrl: "postgres://system:wrong@127.0.0.1:1/none" })).rejects.toThrow();
    expect(await userByEmail(input.email)).toBeUndefined();
  });

  test("a duplicate email is rejected and does not add a second profile", async () => {
    const input = base("f");
    await signUpCustomer(input, deps);
    await expect(signUpCustomer(input, deps)).rejects.toThrow();
    const n = (await admin().query(`select count(*)::int as n from "user" where email = $1`, [input.email])).rows[0].n;
    expect(n).toBe(1);
  });

  test("a too-short password is rejected and creates no user", async () => {
    const input = { ...base("g"), password: "short" };
    await expect(signUpCustomer(input, deps)).rejects.toThrow();
    expect(await userByEmail(input.email)).toBeUndefined();
  });
});
