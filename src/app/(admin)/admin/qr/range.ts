import type { QrRange } from "@/db/qr-admin";

export const RANGES: { value: string; label: string }[] = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "all", label: "All time" },
];

/** The report window from the address, defaulting to 30 days for anything that is not one of the choices. */
export function parseRange(raw: string | string[] | undefined): QrRange {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "7" ? 7 : v === "90" ? 90 : v === "all" ? "all" : 30;
}
