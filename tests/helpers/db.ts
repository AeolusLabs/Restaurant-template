import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { bootstrapRoles } from "../../scripts/lib/bootstrap";
import { freePort, startCluster } from "../../scripts/lib/cluster";
import { runMigrations } from "../../scripts/lib/migrate";

export type DbUrls = { admin: string; migrator: string; app: string; system: string };
export type TestDb = { urls: DbUrls; stop(): Promise<void> };

export const TEST_PASSWORDS = { migrator: "migrator_pw", app: "app_pw", system: "system_pw" };
const DB = "restaurant";

/** A throwaway PostgreSQL 18 cluster: bootstrapped roles, all migrations applied. */
export async function startTestDb(): Promise<TestDb> {
  const dataDir = await mkdtemp(path.join(tmpdir(), "rt-pg-"));
  const port = await freePort();
  const cluster = await startCluster({ dataDir, port, password: "postgres", persistent: false });
  const url = (user: string, pw: string, db: string) => `postgres://${user}:${pw}@127.0.0.1:${port}/${db}`;
  const urls: DbUrls = {
    admin: url("postgres", "postgres", DB),
    migrator: url("migrator", TEST_PASSWORDS.migrator, DB),
    app: url("app", TEST_PASSWORDS.app, DB),
    system: url("system", TEST_PASSWORDS.system, DB),
  };
  await bootstrapRoles(url("postgres", "postgres", "postgres"), TEST_PASSWORDS, DB);
  await runMigrations(urls.migrator);
  return {
    urls,
    async stop() {
      try {
        await cluster.stop();
      } catch (err) {
        // On Windows the data directory can still be locked for a moment when embedded-postgres tries to
        // delete it. The server has stopped by then; the directory is removed below, with retries.
        if ((err as NodeJS.ErrnoException).code !== "EBUSY") throw err;
      }
      await rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }).catch(() => {});
    },
  };
}
