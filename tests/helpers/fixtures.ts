import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { inject } from "vitest";
import type { RequestContext } from "../../src/db/context";
import type { OrderStatus } from "../../src/domain/orders/statuses";
import type { AppRole } from "../../src/domain/roles";

// Setup helpers connect as the superuser, which is exempt from RLS. Tests exercise policies
// through withRequestContext / withSystemContext, never through these.
const urls = inject("dbUrls");
let pool: Pool | undefined;
export const admin = (): Pool => (pool ??= new Pool({ connectionString: urls.admin, max: 3 }));
export async function closeFixtures(): Promise<void> {
  await pool?.end();
  pool = undefined;
}

export async function makeUser(role: AppRole = "customer"): Promise<{ userId: string; ctx: RequestContext }> {
  const userId = randomUUID();
  await admin().query(`insert into "user" (id, name, email) values ($1, $2, $3)`, [
    userId,
    `Test ${role}`,
    `${role}+${userId}@example.com`,
  ]);
  await admin().query(`insert into profiles (id, role, full_name) values ($1, $2, $3)`, [userId, role, `Test ${role}`]);
  return { userId, ctx: { userId, role } };
}

export async function makeOrder(
  profileId: string,
  status: OrderStatus = "placed",
  fulfilment: "pickup" | "delivery" = "pickup",
): Promise<{ orderId: string }> {
  const { rows } = await admin().query(
    `insert into orders (public_code, profile_id, customer_name, status, fulfilment, subtotal_minor, total_minor, currency, expires_at)
     values ($1, $2, 'Test customer', $3, $4, 100000, 100000, 'NGN', now() + interval '30 minutes') returning id`,
    [randomBytes(4).toString("hex"), profileId, status, fulfilment],
  );
  return { orderId: rows[0].id as string };
}
