import { randomBytes } from "node:crypto";
import QRCode from "qrcode";

// QR codes for the restaurant's printed material. The only file that imports the QR library. A code holds a
// scan address (<site>/q/<slug>); the slug is random and never changes, so a printed code stays valid.

/** No i, l, o, 0 or 1: a slug read aloud or typed from a poster should not be ambiguous. */
export const SLUG_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const SLUG_LENGTH = 8;

/** A random slug. Bytes that would favour the start of the alphabet are thrown away, so every character is equally likely. */
export function generateSlug(random: (bytes: number) => Buffer = randomBytes): string {
  const limit = 256 - (256 % SLUG_ALPHABET.length);
  let out = "";
  while (out.length < SLUG_LENGTH) {
    for (const byte of random(SLUG_LENGTH * 2)) {
      if (byte < limit && out.length < SLUG_LENGTH) out += SLUG_ALPHABET[byte % SLUG_ALPHABET.length];
    }
  }
  return out;
}

const SLUG = new RegExp(`^[${SLUG_ALPHABET}]{${SLUG_LENGTH}}$`);
export const isValidSlug = (s: string): boolean => SLUG.test(s);

/** The address a code holds. */
export function scanUrl(appUrl: string, slug: string): string {
  if (!isValidSlug(slug)) throw new Error("Not a QR source slug");
  return `${appUrl.replace(/\/+$/, "")}/q/${slug}`;
}

const OPTIONS = { errorCorrectionLevel: "M", margin: 4 } as const;

/** A sharp-at-any-size image for printing. */
export const qrSvg = (url: string): Promise<string> => QRCode.toString(url, { ...OPTIONS, type: "svg" });

/** A PNG, `width` pixels square. */
export async function qrPng(url: string, width = 1024): Promise<Buffer> {
  if (!Number.isInteger(width) || width < 100 || width > 4096) throw new RangeError("A QR image must be between 100 and 4096 pixels wide");
  return QRCode.toBuffer(url, { ...OPTIONS, type: "png", width });
}
