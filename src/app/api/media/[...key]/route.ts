import { serveMedia } from "@/lib/media";
import { providers } from "@/providers";

/** Public menu pictures, read from the storage provider. See src/lib/media.ts for what is allowed. */
export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params;
  return serveMedia(key, providers().storage);
}
