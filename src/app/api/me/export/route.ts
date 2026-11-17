import { exportCustomerData } from "@/account/export";
import { getRequestIdentity } from "@/auth/session";
import { withScrub } from "@/lib/scrub";

/** The signed-in customer's own data as a JSON download (NDPR and GDPR export). */
export const GET = withScrub(async (request: Request) => {
  const identity = await getRequestIdentity(request.headers);
  if (!identity) return Response.json({ error: "Sign in required" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (identity.ctx.role !== "customer") return Response.json({ error: "Only customer accounts have an export" }, { status: 403 });
  const data = await exportCustomerData(identity.ctx, { email: identity.email });
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": 'attachment; filename="my-data.json"',
      "Cache-Control": "no-store",
    },
  });
});
