import { NextResponse } from "next/server";
import { QR_COOKIE, QR_COOKIE_MAX_AGE_SECONDS, recordScan } from "@/qr/scan";

/**
 * The address a QR code holds. A scan is counted, the slug is kept in a cookie for 7 days so an order placed
 * soon after remembers the code, and the person lands on the menu. A code that is switched off or unknown
 * still lands on the menu, but is not counted or remembered. Nothing about the visitor is stored.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const counted = await recordScan(slug);
  const response = new NextResponse(null, { status: 307, headers: { Location: "/", "Cache-Control": "no-store" } });
  if (counted) {
    response.cookies.set(QR_COOKIE, slug, { httpOnly: true, sameSite: "lax", path: "/", maxAge: QR_COOKIE_MAX_AGE_SECONDS, secure: process.env.NODE_ENV === "production" });
  }
  return response;
}

/** Link previews and crawlers often ask with HEAD: answer, but do not count it. */
export function HEAD() {
  return new NextResponse(null, { status: 307, headers: { Location: "/", "Cache-Control": "no-store" } });
}
