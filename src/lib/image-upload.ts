import { randomUUID } from "node:crypto";

// Menu photos. The type is decided by the file's own first bytes, never by its name or the type the browser
// claims, so a script or HTML file renamed to .jpg is refused. SVG is not accepted at all: it can carry script.

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

export type ImageType = "image/jpeg" | "image/png" | "image/webp";
export type ImageErrorCode = "empty" | "too_large" | "unsupported";

export class ImageError extends Error {
  constructor(
    readonly code: ImageErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const EXTENSION: Record<ImageType, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);

export function detectImageType(bytes: Uint8Array): ImageType | null {
  if (bytes.length >= 3 && startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (bytes.length >= 8 && startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  // WebP is RIFF....WEBP. Other RIFF files (WAV, AVI) start the same way and are refused.
  if (bytes.length >= 12 && startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}

/** Checks an upload and gives it a random storage key. Throws ImageError with a message fit to show. */
export function prepareImage(bytes: Uint8Array): { key: string; contentType: ImageType; bytes: Uint8Array } {
  if (bytes.length === 0) throw new ImageError("empty", "Choose a picture to upload");
  if (bytes.length > MAX_IMAGE_BYTES) throw new ImageError("too_large", "That picture is too big. Use one under 2 MB");
  const contentType = detectImageType(bytes);
  if (!contentType) throw new ImageError("unsupported", "Use a JPEG, PNG or WebP picture");
  return { key: `menu/${randomUUID()}.${EXTENSION[contentType]}`, contentType, bytes };
}
