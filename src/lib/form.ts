import type { z } from "zod";

/** What a server action hands back to its form: a message for the whole form, and/or one per field. */
export type FormState =
  | {
      error?: string;
      /** A confirmation to show in place of the form's usual error (for example, that an email was sent). */
      message?: string;
      fieldErrors?: Record<string, string>;
      /** What the person typed (never a password), so the form can show it again instead of coming back empty. */
      values?: Record<string, string>;
    }
  | undefined;

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

/** The submitted values of these fields, to hand back to the form when it has to be shown again. */
export function echo(form: FormData, keys: string[]): Record<string, string> {
  return Object.fromEntries(keys.map((k) => [k, text(form, k)]));
}
