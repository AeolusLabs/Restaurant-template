import { sql } from "drizzle-orm";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, inject, test } from "vitest";
import {
  InvalidContextError,
  closePools,
  getPool,
  withRequestContext,
  type RequestContext,
} from "../src/db/context";
import { APP_ROLES } from "../src/domain/roles";

const urls = inject("dbUrls");
const A = "0194f3c0-0000-7000-8000-00000000000a";
const B = "0194f3c0-0000-7000-8000-00000000000b";
const ctxA: RequestContext = { userId: A, role: "customer" };
const ctxB: RequestContext = { userId: B, role: "customer" };

async function asMigrator<T = Record<string, unknown>>(query: string): Promise<T[]> {
  const c = new Client({ connectionString: urls.migrator });
  await c.connect();
  try {
    return (await c.query(query)).rows as T[];
  } finally {
    await c.end();
  }
}

const run = <T>(ctx: RequestContext, fn: Parameters<typeof withRequestContext<T>>[1], max?: number) =>
  withRequestContext(ctx, fn, { url: urls.app, max });

beforeAll(async () => {
  await asMigrator(`
    create table ctx_probe (id uuid primary key default uuidv7(), owner uuid not null);
    alter table ctx_probe enable row level security;
    alter table ctx_probe force row level security;
    create policy probe_owner on ctx_probe
      using (owner = current_app_user()) with check (owner = current_app_user());
    grant select, insert on ctx_probe to app;
  `);
  for (const ctx of [ctxA, ctxB]) {
    await run(ctx, (tx) => tx.execute(sql`insert into ctx_probe (owner) values (${ctx.userId}::uuid), (${ctx.userId}::uuid)`));
  }
});

afterAll(async () => {
  await closePools();
  await asMigrator("drop table if exists ctx_probe");
});

describe("request context", () => {
  test("no context returns zero rows", async () => {
    const c = new Client({ connectionString: urls.app });
    await c.connect();
    try {
      const { rows } = await c.query("select count(*)::int as n from ctx_probe");
      expect(rows[0].n).toBe(0);
    } finally {
      await c.end();
    }
  });

  test("a user sees only their own rows", async () => {
    const rows = await run(ctxA, (tx) => tx.execute(sql`select owner::text as owner from ctx_probe`));
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.every((r) => r.owner === A)).toBe(true);
  });

  test("current_app_role() equals the context role", async () => {
    for (const role of APP_ROLES) {
      const r = await run({ userId: A, role }, (tx) => tx.execute(sql`select current_app_role() as role, current_app_user()::text as uid`));
      expect(r.rows[0]).toEqual({ role, uid: A });
    }
  });

  test("a user cannot insert a row owned by someone else", async () => {
    await expect(
      run(ctxA, (tx) => tx.execute(sql`insert into ctx_probe (owner) values (${B}::uuid)`)),
    ).rejects.toThrow();
  });

  test("rejects a userId that is not a UUID, before any query runs", async () => {
    let touched = false;
    const never = { url: "postgres://x:y@127.0.0.1:1/none" };
    for (const userId of ["", "not-a-uuid", "1' or '1'='1", `${A}; drop table ctx_probe`]) {
      await expect(
        withRequestContext({ userId, role: "customer" }, async () => {
          touched = true;
        }, never),
      ).rejects.toBeInstanceOf(InvalidContextError);
    }
    expect(touched).toBe(false);
  });

  test("rejects 'admin' and an injected string as roles, before any query runs", async () => {
    const never = { url: "postgres://x:y@127.0.0.1:1/none" };
    for (const role of ["admin", "owner; drop table ctx_probe", "system", "OWNER", ""]) {
      await expect(
        withRequestContext({ userId: A, role: role as never }, async () => "x", never),
      ).rejects.toBeInstanceOf(InvalidContextError);
    }
  });

  test("context does not leak to the next request on a reused connection", async () => {
    for (let i = 0; i < 20; i++) {
      const ctx = i % 2 === 0 ? ctxA : ctxB;
      const r = await run(ctx, (tx) => tx.execute(sql`select count(*)::int as n from ctx_probe`), 1);
      expect(r.rows[0].n).toBe(2);
    }
    const pool = getPool(urls.app, 1);
    const raw = await pool.query("select count(*)::int as n from ctx_probe");
    expect(raw.rows[0].n).toBe(0);
    const leftover = await pool.query("select nullif(current_setting('app.user_id', true), '') as uid, nullif(current_setting('app.role', true), '') as role");
    expect(leftover.rows[0]).toEqual({ uid: null, role: null });
  });

  test("the table owner is also subject to the policy", async () => {
    const rows = await asMigrator<{ n: number }>("select count(*)::int as n from ctx_probe");
    expect(rows[0].n).toBe(0);
  });

  test("a failing callback rolls the transaction back", async () => {
    await expect(
      run(ctxA, async (tx) => {
        await tx.execute(sql`insert into ctx_probe (owner) values (${A}::uuid)`);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const r = await run(ctxA, (tx) => tx.execute(sql`select count(*)::int as n from ctx_probe`));
    expect(r.rows[0].n).toBe(2);
  });
});
