import { getRequestIdentity } from "@/auth/session";
import { getQrSource } from "@/db/qr-admin";
import { loadEnv } from "@/lib/env";
import { qrPng, qrSvg, scanUrl } from "@/lib/qr";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers = { "Cache-Control": "private, no-store" };

/** A QR code as a download, for managers and owners: ?format=png (default) or ?format=svg. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return new Response("Not found", { status: 404, headers });
  const identity = await getRequestIdentity(request.headers);
  if (!identity) return new Response("Sign in required", { status: 401, headers });
  if (identity.ctx.role !== "owner" && identity.ctx.role !== "manager") return new Response("Forbidden", { status: 403, headers });
  const source = await getQrSource(identity.ctx, id, "all");
  if (!source) return new Response("Not found", { status: 404, headers });

  const url = scanUrl(loadEnv().APP_URL, source.slug);
  const format = new URL(request.url).searchParams.get("format") === "svg" ? "svg" : "png";
  const disposition = `attachment; filename="qr-${source.slug}.${format}"`;
  if (format === "svg") return new Response(await qrSvg(url), { headers: { ...headers, "Content-Type": "image/svg+xml", "Content-Disposition": disposition } });
  return new Response(new Uint8Array(await qrPng(url)), { headers: { ...headers, "Content-Type": "image/png", "Content-Disposition": disposition } });
}
