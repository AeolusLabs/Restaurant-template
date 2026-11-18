import type { StorageProvider } from "@/providers/storage/types";

// Serves stored menu pictures. Only keys this app generates are accepted (menu/<uuid>.<ext>), so a request
// cannot reach any other object or climb out of the folder, and only image types are ever sent back.

const KEY = /^menu\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const notFound = () => new Response("Not found", { status: 404 });

export async function serveMedia(parts: string[], storage: StorageProvider): Promise<Response> {
  const key = parts.join("/");
  if (parts.length !== 2 || !KEY.test(key)) return notFound();
  const found = await storage.getStream(key);
  if (!found || !IMAGE_TYPES.has(found.contentType)) return notFound();
  return new Response(found.stream, {
    headers: {
      "Content-Type": found.contentType,
      // Keys are random and never reused, so a stored picture never changes.
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
