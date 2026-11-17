import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import net from "node:net";
import path from "node:path";

export type Cluster = { port: number; stop(): Promise<void> };

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

/** Starts a real PostgreSQL 18 cluster from the embedded-postgres binaries. No Docker needed. */
export async function startCluster(o: {
  dataDir: string;
  port: number;
  password: string;
  persistent: boolean;
}): Promise<Cluster> {
  const pg = new EmbeddedPostgres({
    databaseDir: o.dataDir,
    user: "postgres",
    password: o.password,
    port: o.port,
    persistent: o.persistent,
    onLog: () => {},
    onError: () => {},
  });
  if (!existsSync(path.join(o.dataDir, "PG_VERSION"))) await pg.initialise();
  await pg.start();
  return { port: o.port, stop: () => pg.stop() };
}
