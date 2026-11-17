import { Client } from "pg";
import { describe, expect, inject, test } from "vitest";
import { runMigrations } from "../scripts/lib/migrate";

const urls = inject("dbUrls");

async function q<T = Record<string, unknown>>(url: string, sql: string): Promise<T[]> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    return (await c.query(sql)).rows as T[];
  } finally {
    await c.end();
  }
}

describe("database foundation", () => {
  test("server is PostgreSQL 18", async () => {
    const [row] = await q<{ version: string }>(urls.app, "select version()");
    expect(row.version).toMatch(/^PostgreSQL 18/);
  });

  test("uuidv7() is available and returns a version 7 UUID", async () => {
    const [row] = await q<{ id: string }>(urls.app, "select uuidv7()::text as id");
    expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  test("migrator, app and system roles exist and none is superuser or bypasses RLS", async () => {
    const rows = await q<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>(
      urls.admin,
      "select rolname, rolsuper, rolbypassrls from pg_roles where rolname in ('migrator','app','system') order by rolname",
    );
    expect(rows.map((r) => r.rolname)).toEqual(["app", "migrator", "system"]);
    for (const r of rows) {
      expect(r.rolsuper).toBe(false);
      expect(r.rolbypassrls).toBe(false);
    }
  });

  test("the migrator owns the public schema", async () => {
    const [row] = await q<{ owner: string }>(
      urls.admin,
      "select nspowner::regrole::text as owner from pg_namespace where nspname = 'public'",
    );
    expect(row.owner).toBe("migrator");
  });

  test("app and system roles cannot create tables", async () => {
    for (const url of [urls.app, urls.system]) {
      await expect(q(url, "create table should_not_exist (id int)")).rejects.toThrow(/permission denied/);
    }
  });

  test("running migrations twice applies nothing the second time", async () => {
    const second = await runMigrations(urls.migrator);
    expect(second.applied).toBe(0);
  });
});
