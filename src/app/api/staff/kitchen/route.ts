import { getRequestIdentity } from "@/auth/session";
import { listOrdersForStaff } from "@/db/staff-orders";
import { authorizeStream } from "@/realtime/sse";
import { toStaffOrder } from "@/lib/sanitize";
import { withScrub } from "@/lib/scrub";

/** The orders the kitchen is working on, for the live display to refetch. Row-level security decides what each role sees. */
export const GET = withScrub(async (request: Request) => {
  const identity = await getRequestIdentity(request.headers);
  const denied = authorizeStream(identity?.ctx.role ?? null);
  if (denied) return Response.json({ error: denied === 401 ? "Sign in required" : "Staff only" }, { status: denied, headers: { "Cache-Control": "no-store" } });
  const rows = await listOrdersForStaff(identity!.ctx, { statuses: ["paid", "accepted", "preparing", "ready"], limit: 200 });
  return Response.json({ orders: rows.map((r) => toStaffOrder(r.order, r.items, r.phone)) }, { headers: { "Cache-Control": "no-store" } });
});
