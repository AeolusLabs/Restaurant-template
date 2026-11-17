import { Client } from "pg";

export type RolePasswords = { migrator: string; app: string; system: string };

async function run(c: Client, template: string, ...args: string[]) {
  // format() quotes identifiers (%I) and literals (%L) on the server.
  const params = args.map((_, i) => `$${i + 2}::text`).join(", ");
  const { rows } = await c.query<{ q: string }>(`select format($1, ${params}) as q`, [template, ...args]);
  await c.query(rows[0].q);
}

function withDatabase(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

/**
 * Creates the three login roles and the application database. Idempotent.
 * Run as a superuser. Roles never get SUPERUSER or BYPASSRLS.
 */
export async function bootstrapRoles(
  adminUrl: string,
  passwords: RolePasswords,
  dbName = "restaurant",
): Promise<void> {
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    for (const [role, password] of Object.entries(passwords)) {
      const { rowCount } = await admin.query("select 1 from pg_roles where rolname = $1", [role]);
      const verb = rowCount ? "alter role %I" : "create role %I";
      await run(admin, `${verb} login nosuperuser nocreatedb nocreaterole nobypassrls password %L`, role, password);
    }
    const db = await admin.query("select 1 from pg_database where datname = $1", [dbName]);
    if (!db.rowCount) await run(admin, "create database %I owner migrator", dbName);
  } finally {
    await admin.end();
  }

  const inDb = new Client({ connectionString: withDatabase(adminUrl, dbName) });
  await inDb.connect();
  try {
    await run(inDb, "revoke connect on database %I from public", dbName);
    await run(inDb, "grant connect on database %I to migrator, app, system", dbName);
    await inDb.query("alter schema public owner to migrator");
  } finally {
    await inDb.end();
  }
}
