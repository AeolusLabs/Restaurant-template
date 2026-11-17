import type { z } from "zod";

/** What a server action hands back to its form: a message for the whole form, and/or one per field. */
export type FormState = { error?: string; fieldErrors?: Record<string, string> } | undefined;

/** One string field from a submitted form, or "" when it is missing or a file. */
export function text(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
}

/** The first message for each field that failed validation, keyed by the field's name. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) out[String(issue.path[0] ?? "form")] ??= issue.message;
  return out;
}
