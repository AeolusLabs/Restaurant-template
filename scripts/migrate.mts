import "dotenv/config";
import { runMigrations } from "./lib/migrate";

const url = process.env.DATABASE_MIGRATOR_URL;
if (!url) throw new Error("DATABASE_MIGRATOR_URL is required");
const { applied } = await runMigrations(url);
console.log(`Applied ${applied} migration(s).`);
