import { getRequestIdentity } from "@/auth/session";
import { getOrderForCustomer } from "@/db/orders";
import { toPublicOrder } from "@/lib/sanitize";
import { withScrub } from "@/lib/scrub";

const CODE = /^[A-Z0-9]{6}$/;
const headers = { "Cache-Control": "no-store" };

/** The order tracking page polls this. A customer only ever gets their own order (row-level security). */
export const GET = withScrub(async (request: Request, { params }: { params: Promise<{ code: string }> }) => {
  const { code } = await params;
  if (!CODE.test(code)) return Response.json({ error: "Order not found" }, { status: 404, headers });
  const identity = await getRequestIdentity(request.headers);
  if (!identity) return Response.json({ error: "Sign in required" }, { status: 401, headers });
  const found = await getOrderForCustomer(identity.ctx, code);
  if (!found) return Response.json({ error: "Order not found" }, { status: 404, headers });
  return Response.json({ order: toPublicOrder(found.order, found.items) }, { headers });
});
