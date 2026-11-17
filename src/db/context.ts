import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { APP_ROLES, type AppRole } from "@/domain/roles";

// The only module (with scripts and test helpers) that imports the pg Pool.
// Every query runs inside a transaction that first tells Postgres who is asking.
// RLS policies read that identity through current_app_user() and current_app_role().
// With no identity set, every policy evaluates to false and queries return no rows.

export type Tx = Parameters<Parameters<NodePgDatabase["transaction"]>[0]>[0];
export type RequestContext = { userId: string; role: AppRole };
export type ContextOptions = { url?: string; max?: number };

export class InvalidContextError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const pools = new Map<string, Pool>();

export function getPool(url: string, max = 10): Pool {
  const key = `${max}|${url}`;
  let pool = pools.get(key);
  if (!pool) {
    pool = new Pool({ connectionString: url, max });
    pools.set(key, pool);
  }
  return pool;
}

export async function closePools(): Promise<void> {
  const all = [...pools.values()];
  pools.clear();
  await Promise.all(all.map((p) => p.end()));
}

function urlFor(envKey: "DATABASE_URL" | "DATABASE_SYSTEM_URL", opts?: ContextOptions): string {
  const url = opts?.url ?? process.env[envKey];
  if (!url) throw new Error(`${envKey} is not set`);
  return url;
}

function validate(ctx: RequestContext): void {
  if (typeof ctx.userId !== "string" || !UUID.test(ctx.userId)) {
    throw new InvalidContextError("Request context userId must be a UUID");
  }
  if (!(APP_ROLES as readonly string[]).includes(ctx.role)) {
    throw new InvalidContextError(`Request context role must be one of ${APP_ROLES.join(", ")}`);
  }
}

function inTransaction<T>(pool: Pool, identity: { userId: string; role: string }, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return drizzle(pool).transaction(async (tx) => {
    // is_local = true: the setting dies with the transaction, so a pooled connection never carries it over.
    await tx.execute(
      sql`select set_config('app.user_id', ${identity.userId}, true), set_config('app.role', ${identity.role}, true)`,
    );
    return fn(tx);
  });
}

/** Runs fn as the signed-in user, with their role, in one transaction (the `app` database role). */
export async function withRequestContext<T>(
  ctx: RequestContext,
  fn: (tx: Tx) => Promise<T>,
  opts?: ContextOptions,
): Promise<T> {
  validate(ctx);
  return inTransaction(getPool(urlFor("DATABASE_URL", opts), opts?.max), ctx, fn);
}

/**
 * Runs fn as an anonymous visitor: the `app` database role with no identity set, so every policy
 * that needs one evaluates to false. The only table this reads is the active menu, which RLS
 * leaves open on purpose (docs/phase-1-build-log.md). Never use it to write.
 */
export async function withPublicContext<T>(fn: (tx: Tx) => Promise<T>, opts?: ContextOptions): Promise<T> {
  return drizzle(getPool(urlFor("DATABASE_URL", opts), opts?.max)).transaction(fn);
}

/** Runs fn as the system actor (webhooks, jobs, seeds) in one transaction (the `system` database role). */
export async function withSystemContext<T>(fn: (tx: Tx) => Promise<T>, opts?: ContextOptions): Promise<T> {
  return inTransaction(getPool(urlFor("DATABASE_SYSTEM_URL", opts), opts?.max), { userId: "", role: "system" }, fn);
}
