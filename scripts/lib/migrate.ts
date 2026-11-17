import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import { Pool } from "pg";

async function countApplied(pool: Pool): Promise<number> {
  const exists = await pool.query("select to_regclass('drizzle.__drizzle_migrations') as t");
  if (!exists.rows[0].t) return 0;
  const { rows } = await pool.query("select count(*)::int as n from drizzle.__drizzle_migrations");
  return rows[0].n;
}

/** Applies every pending migration in db/migrations as the migrator role. */
export async function runMigrations(
  migratorUrl: string,
  folder = path.resolve(process.cwd(), "db/migrations"),
): Promise<{ applied: number }> {
  const pool = new Pool({ connectionString: migratorUrl, max: 1 });
  try {
    const before = await countApplied(pool);
    await migrate(drizzle(pool), { migrationsFolder: folder });
    return { applied: (await countApplied(pool)) - before };
  } finally {
    await pool.end();
  }
}
