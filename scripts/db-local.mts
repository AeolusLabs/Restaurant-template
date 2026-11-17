import "dotenv/config";
import path from "node:path";
import { startCluster } from "./lib/cluster";

// Long-running development database on port 54329. Stop with Ctrl+C.
const url = new URL(process.env.DATABASE_ADMIN_URL ?? "postgres://postgres:postgres@127.0.0.1:54329/postgres");
const cluster = await startCluster({
  dataDir: path.resolve(process.cwd(), ".pgdata"),
  port: Number(url.port || 54329),
  password: decodeURIComponent(url.password || "postgres"),
  persistent: true,
});
console.log(`PostgreSQL 18 running on port ${cluster.port}. Press Ctrl+C to stop.`);
const stop = async () => {
  await cluster.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
