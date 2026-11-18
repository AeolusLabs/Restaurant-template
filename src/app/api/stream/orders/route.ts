import { getRequestIdentity } from "@/auth/session";
import { authorizeStream, createOrderStream } from "@/realtime/sse";
import { orderEvents } from "@/realtime/order-events";

/** Live order changes for signed-in staff (kitchen, manager, owner), as Server-Sent Events. */
export async function GET(request: Request) {
  const identity = await getRequestIdentity(request.headers);
  const denied = authorizeStream(identity?.ctx.role ?? null);
  if (denied) return Response.json({ error: denied === 401 ? "Sign in required" : "Staff only" }, { status: denied });
  return new Response(createOrderStream(orderEvents(), request.signal), {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
