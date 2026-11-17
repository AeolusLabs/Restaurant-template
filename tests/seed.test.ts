import { afterAll, describe, expect, inject, test } from "vitest";
import { createAuth } from "../src/auth/auth";
import { closePools } from "../src/db/context";
import { SEED_MENU, seedMenu } from "../db/seed/menu";
import { seedOwnerFromEnv } from "../db/seed/owner";
import { admin, closeFixtures } from "./helpers/fixtures";

const urls = inject("dbUrls");
const auth = createAuth({
  databaseUrl: urls.system,
  secret: "test-secret-that-is-at-least-32-characters",
  baseURL: "http://localhost:3000",
});
const deps = { auth, systemUrl: urls.system };

afterAll(async () => {
  await closePools();
  await closeFixtures();
});

type SeedItem = { slug: string; name: string; priceMinor: number };
const allSeedItems: SeedItem[] = SEED_MENU.categories.flatMap((c) => c.items.map((i): SeedItem => i));
const slugs = SEED_MENU.categories.map((c) => c.slug);
const itemSlugs = allSeedItems.map((i) => i.slug);
const counts = async () => ({
  categories: (await admin().query(`select count(*)::int as n from menu_categories where slug = any($1)`, [slugs])).rows[0].n,
  items: (await admin().query(`select count(*)::int as n from menu_items where slug = any($1)`, [itemSlugs])).rows[0].n,
  groups: (await admin().query(`select count(*)::int as n from modifier_groups g join menu_items i on i.id = g.item_id where i.slug = any($1)`, [itemSlugs])).rows[0].n,
  modifiers: (
    await admin().query(
      `select count(*)::int as n from modifiers m join modifier_groups g on g.id = m.group_id join menu_items i on i.id = g.item_id where i.slug = any($1)`,
      [itemSlugs],
    )
  ).rows[0].n,
});

describe("seedMenu", () => {
  test("seeds two categories, six items and one modifier group", async () => {
    await seedMenu({ url: urls.system });
    const c = await counts();
    expect(c.categories).toBe(2);
    expect(c.items).toBe(6);
    expect(c.groups).toBe(1);
    expect(c.modifiers).toBeGreaterThanOrEqual(2);
  });

  test("running it twice leaves the same row counts", async () => {
    await seedMenu({ url: urls.system });
    const first = await counts();
    await seedMenu({ url: urls.system });
    expect(await counts()).toEqual(first);
  });

  test("every seeded price is a positive integer in kobo", () => {
    for (const cat of SEED_MENU.categories)
      for (const item of cat.items) {
        expect(Number.isSafeInteger(item.priceMinor), item.slug).toBe(true);
        expect(item.priceMinor, item.slug).toBeGreaterThan(0);
      }
  });

  test("an edited price goes back to the seed value without duplicating the row", async () => {
    const slug = itemSlugs[0];
    await admin().query(`update menu_items set price_minor = 1, name = 'Edited' where slug = $1`, [slug]);
    await seedMenu({ url: urls.system });
    const rows = (await admin().query(`select price_minor, name from menu_items where slug = $1`, [slug])).rows;
    expect(rows).toHaveLength(1);
    const seeded = allSeedItems.find((i) => i.slug === slug)!;
    // node-pg returns bigint as a string; the app reads it back as a number through Drizzle.
    expect({ price: Number(rows[0].price_minor), name: rows[0].name }).toEqual({ price: seeded.priceMinor, name: seeded.name });
  });

  test("an item added by the restaurant is left alone", async () => {
    const [{ id }] = (await admin().query(`select id from menu_categories where slug = $1`, [slugs[0]])).rows;
    await admin().query(`insert into menu_items (category_id, slug, name, price_minor) values ($1, 'house-special-test', 'House special', 500000)`, [id]);
    await seedMenu({ url: urls.system });
    expect((await admin().query(`select 1 from menu_items where slug = 'house-special-test'`)).rowCount).toBe(1);
  });
});

describe("seedOwnerFromEnv", () => {
  const email = `first-owner+${Date.now()}@example.com`;
  const env = { INITIAL_OWNER_EMAIL: email, INITIAL_OWNER_PASSWORD: "a strong first password" };

  test("creates exactly one owner and a second call creates none", async () => {
    expect(await seedOwnerFromEnv(env, deps)).toEqual({ created: true });
    expect(await seedOwnerFromEnv(env, deps)).toEqual({ created: false });
    const owners = (
      await admin().query(`select p.role from profiles p join "user" u on u.id = p.id where u.email = $1`, [email])
    ).rows;
    expect(owners).toEqual([{ role: "owner" }]);
  });

  test("the owner's password is stored hashed and they can sign in", async () => {
    const pw = (await admin().query(`select a.password from account a join "user" u on u.id = a.user_id where u.email = $1`, [email])).rows[0].password;
    expect(pw).not.toContain(env.INITIAL_OWNER_PASSWORD);
    const res = await auth.api.signInEmail({ body: { email, password: env.INITIAL_OWNER_PASSWORD } });
    expect(res.user.email).toBe(email);
  });

  test("does nothing when the environment variables are unset", async () => {
    // Other test files create users in the same database at the same time, so check this test's own
    // email rather than counting every user.
    const only = `only-email+${Date.now()}@example.com`;
    expect(await seedOwnerFromEnv({}, deps)).toEqual({ created: false });
    expect(await seedOwnerFromEnv({ INITIAL_OWNER_EMAIL: only }, deps)).toEqual({ created: false });
    expect(await seedOwnerFromEnv({ INITIAL_OWNER_PASSWORD: "a strong first password" }, deps)).toEqual({ created: false });
    expect((await admin().query(`select 1 from "user" where email = $1`, [only])).rowCount).toBe(0);
  });

  test("a weak password stops the seed with a clear error and creates nothing", async () => {
    const weak = { INITIAL_OWNER_EMAIL: `weak+${Date.now()}@example.com`, INITIAL_OWNER_PASSWORD: "short" };
    await expect(seedOwnerFromEnv(weak, deps)).rejects.toThrow(/password/i);
    expect((await admin().query(`select 1 from "user" where email = $1`, [weak.INITIAL_OWNER_EMAIL])).rowCount).toBe(0);
  });
});
