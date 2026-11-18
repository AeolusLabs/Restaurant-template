import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { closePools } from "@/db/context";
import { seedDemo } from "../db/seed/demo";
import { seedMenu } from "../db/seed/menu";

// Fictional customers and two weeks of orders, for a showcase deployment. Needs features.demo_mode and the privileged
// connection (DATABASE_ADMIN_URL), like db:bootstrap, because it back-dates orders. Safe to re-run.
const admin = process.env.DATABASE_ADMIN_URL;
const app = process.env.DATABASE_URL;
if (!admin || !app) throw new Error("DATABASE_ADMIN_URL and DATABASE_URL are required");
// The admin URL usually names the maintenance database; the demo belongs in the app's own.
const adminUrl = new URL(admin);
adminUrl.pathname = new URL(app).pathname;

const pool = new Pool({ connectionString: adminUrl.toString(), max: 2 });
try {
  await seedMenu();
  const r = await seedDemo({ db: drizzle(pool) });
  console.log(`Demo data ready: ${r.customers} customers, ${r.orders} orders (${r.paid} paid, ${r.cancelled} unpaid and cancelled, ${r.refunded} refunded).`);
  if (r.removedOrders > 0) console.log(`Replaced ${r.removedOrders} orders from an earlier run.`);
} finally {
  await pool.end();
  await closePools();
}
