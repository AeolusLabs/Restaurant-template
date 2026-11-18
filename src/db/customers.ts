import { sql } from "drizzle-orm";
import { requireRole, type AuthDeps } from "@/auth/session";
import { withSystemContext, type RequestContext } from "./context";

// What the admin customer screens read. Managers and owners only. It runs as the system role because the email
// lives with the sign-in account, not the profile (the same reason the staff list does); the role is checked
// here first. "Orders" are orders that were paid; "spend" is the total of orders that were completed, so a
// refunded or cancelled order is never spend.

export type CustomerSort = "recent" | "spend" | "orders" | "joined";
export type CustomerRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  blocked: boolean;
  joinedAt: Date;
  orders: number;
  spentMinor: number;
  lastOrderAt: Date | null;
};
export type CustomerOrder = { publicCode: string; status: string; fulfilment: string; totalMinor: number; placedAt: Date; promoCode: string | null };
export type CustomerDetail = CustomerRow & { marketingConsent: boolean; orderList: CustomerOrder[] };

/** Makes text safe inside an ILIKE pattern, so a search for "%" finds a percent sign, not everyone. */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

const PAID = sql`exists (select 1 from payments pay where pay.order_id = o.id and pay.status in ('succeeded', 'refunded', 'partially_refunded'))`;

const ORDER_BY: Record<CustomerSort, ReturnType<typeof sql>> = {
  recent: sql`max(o.placed_at) desc nulls last, p.created_at desc`,
  spend: sql`spent desc, p.created_at desc`,
  orders: sql`orders desc, p.created_at desc`,
  joined: sql`p.created_at desc`,
};

const SELECT = sql`
  select p.id, p.full_name, u.email, p.phone, p.blocked_at, p.created_at,
    (count(o.id) filter (where ${PAID}))::int as orders,
    coalesce(sum(o.total_minor) filter (where o.status = 'completed'), 0)::bigint as spent,
    max(o.placed_at) filter (where ${PAID}) as last_order
  from profiles p
  join "user" u on u.id = p.id
  left join orders o on o.profile_id = p.id`;

function toRow(r: Record<string, unknown>): CustomerRow {
  return {
    id: r.id as string,
    name: r.full_name as string,
    email: r.email as string,
    phone: (r.phone as string | null) ?? null,
    blocked: r.blocked_at !== null,
    joinedAt: new Date(r.created_at as string),
    orders: Number(r.orders),
    spentMinor: Number(r.spent),
    lastOrderAt: r.last_order ? new Date(r.last_order as string) : null,
  };
}

/** Customers (never staff), with how much they have ordered and spent. Searches name, email and phone. */
export async function listCustomers(
  actor: RequestContext,
  query: { search?: string; sort?: CustomerSort; limit?: number } = {},
  deps: AuthDeps = {},
): Promise<CustomerRow[]> {
  requireRole(actor, ["owner", "manager"]);
  const term = query.search?.trim();
  const pattern = term ? `%${escapeLike(term)}%` : null;
  const where = pattern
    ? sql`p.role = 'customer' and p.deleted_at is null and (p.full_name ilike ${pattern} or u.email ilike ${pattern} or p.phone ilike ${pattern} or p.id::text ilike ${pattern})`
    : sql`p.role = 'customer' and p.deleted_at is null`;
  const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
  const { rows } = await withSystemContext(
    (tx) => tx.execute(sql`${SELECT} where ${where} group by p.id, u.email order by ${ORDER_BY[query.sort ?? "recent"]} limit ${limit}`),
    { url: deps.systemUrl },
  );
  return rows.map(toRow);
}

/** One customer with their orders, newest first, or null when there is no such customer. */
export async function getCustomer(actor: RequestContext, id: string, deps: AuthDeps = {}): Promise<CustomerDetail | null> {
  requireRole(actor, ["owner", "manager"]);
  return withSystemContext(
    async (tx) => {
      const { rows } = await tx.execute(sql`${SELECT} where p.id = ${id}::uuid and p.role = 'customer' and p.deleted_at is null group by p.id, u.email`);
      if (rows.length === 0) return null;
      const consent = await tx.execute(
        sql`select 1 from consents where profile_id = ${id}::uuid and type = 'marketing' and withdrawn_at is null limit 1`,
      );
      const list = await tx.execute(
        sql`select public_code, status, fulfilment, total_minor, placed_at, promo_code from orders where profile_id = ${id}::uuid order by placed_at desc limit 100`,
      );
      return {
        ...toRow(rows[0]),
        marketingConsent: consent.rows.length > 0,
        orderList: list.rows.map((o) => ({
          publicCode: o.public_code as string,
          status: o.status as string,
          fulfilment: o.fulfilment as string,
          totalMinor: Number(o.total_minor),
          placedAt: new Date(o.placed_at as string),
          promoCode: (o.promo_code as string | null) ?? null,
        })),
      };
    },
    { url: deps.systemUrl },
  );
}
