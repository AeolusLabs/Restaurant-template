import "dotenv/config";
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

try {
  await seedMenu();
  const r = await seedDemo({ adminUrl: adminUrl.toString() });
  console.log(`Demo data ready: ${r.customers} customers, ${r.orders} orders (${r.paid} paid, ${r.cancelled} unpaid and cancelled, ${r.refunded} refunded).`);
  if (r.removedOrders > 0) console.log(`Replaced ${r.removedOrders} orders from an earlier run.`);
} finally {
  await closePools();
}
