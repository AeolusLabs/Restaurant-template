import { eq } from "drizzle-orm";
import { withSystemContext } from "@/db/context";
import { qrScans, qrSources } from "@/db/schema";
import { isValidSlug } from "@/lib/qr";

/** The cookie that carries the last code a visitor scanned until they order. */
export const QR_COOKIE = "qr_source";
/** Last touch within 7 days: a scan older than that is not credited with an order. */
export const QR_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 3600;

/**
 * Counts one visit to a code's address. Returns whether it was counted: a switched-off, unknown or malformed
 * slug counts nothing. Stores a source and a time, never anything about the visitor.
 */
export async function recordScan(slug: string, deps: { systemUrl?: string } = {}): Promise<boolean> {
  if (!isValidSlug(slug)) return false;
  return withSystemContext(
    async (tx) => {
      const [found] = await tx.select({ id: qrSources.id, active: qrSources.active }).from(qrSources).where(eq(qrSources.slug, slug));
      if (!found?.active) return false;
      await tx.insert(qrScans).values({ sourceId: found.id });
      return true;
    },
    { url: deps.systemUrl },
  );
}

const AUTOMATED_AGENT = /bot|crawl|spider|preview|facebookexternalhit|slackbot|whatsapp|telegram|twitter|linkedin|embedly|headless|curl|wget/i;

/**
 * A visit that is not a person scanning a code: a browser prefetching the link, a chat app building a link preview,
 * a search crawler. These still get the redirect but are not counted, so the scan figures are not inflated.
 */
export function isAutomatedVisit(headers: Headers): boolean {
  const purpose = `${headers.get("sec-purpose") ?? ""} ${headers.get("purpose") ?? ""} ${headers.get("x-moz") ?? ""}`;
  return /prefetch|preview/i.test(purpose) || AUTOMATED_AGENT.test(headers.get("user-agent") ?? "");
}
