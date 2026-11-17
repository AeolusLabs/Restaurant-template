import { NextResponse, type NextRequest } from "next/server";
import { checkOriginLock, securityHeaders } from "@/lib/perimeter";

// Next.js 16 calls this file "proxy" (it was "middleware"). It runs on the Node.js runtime.
// It cannot rewrite response bodies, so the sensitive-field scrubber is applied per route
// handler with withScrub() from src/lib/scrub.ts.
export function proxy(request: NextRequest) {
  if (!checkOriginLock(request.headers, process.env.ORIGIN_LOCK_SECRET)) {
    return new NextResponse("Forbidden", { status: 403, headers: securityHeaders() });
  }
  const response = NextResponse.next();
  for (const [name, value] of Object.entries(securityHeaders())) response.headers.set(name, value);
  return response;
}

export const config = {
  // Everything except Next's static assets and the favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
