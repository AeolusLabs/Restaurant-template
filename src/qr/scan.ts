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
      const [found] = await tx.select({ id: qrSources.id }).from(qrSources).where(eq(qrSources.slug, slug));
      if (!found) return false;
      const [source] = await tx.select({ active: qrSources.active }).from(qrSources).where(eq(qrSources.id, found.id));
      if (!source?.active) return false;
      await tx.insert(qrScans).values({ sourceId: found.id });
      return true;
    },
    { url: deps.systemUrl },
  );
}
