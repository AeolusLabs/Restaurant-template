"use server";

import { APIError } from "better-auth/api";
import { sql } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withSystemContext } from "@/db/context";
import { safeNext } from "@/lib/safe-redirect";
import { getAuth } from "./auth";
import { ConsentRequiredError, signUpCustomer } from "./signup";

export type FormState = { error?: string; fieldErrors?: Record<string, string> } | undefined;

const text = (f: FormData, k: string): string => {
  const v = f.get(k);
  return typeof v === "string" ? v : "";
};

const signInSchema = z.object({ email: z.email("Enter a valid email"), password: z.string().min(1, "Enter your password") });
const signUpSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(200),
  email: z.email("Enter a valid email"),
  password: z.string().min(8, "Use at least 8 characters").max(128),
});

function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) out[String(issue.path[0] ?? "form")] ??= issue.message;
  return out;
}

export async function signInAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signInSchema.safeParse({ email: text(formData, "email"), password: text(formData, "password") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const { email, password } = parsed.data;

  // Say plainly when an account has been blocked, instead of a password error that never goes away.
  const { rows } = await withSystemContext((tx) =>
    tx.execute(sql`select p.blocked_at, p.deleted_at from "user" u join profiles p on p.id = u.id where u.email = ${email.toLowerCase()}`),
  );
  if (rows[0]?.blocked_at || rows[0]?.deleted_at) {
    return { error: "This account cannot sign in. Please contact the restaurant." };
  }

  try {
    await getAuth().api.signInEmail({ body: { email, password }, headers: await headers() });
  } catch (err) {
    if (err instanceof APIError) return { error: "The email or password is not right." };
    throw err;
  }
  redirect(safeNext(text(formData, "next")));
}

export async function signUpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signUpSchema.safeParse({ name: text(formData, "name"), email: text(formData, "email"), password: text(formData, "password") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  try {
    await signUpCustomer({
      ...parsed.data,
      // Checkboxes only send a value when ticked. Nothing is ticked for the customer.
      consent: { terms: formData.get("terms") === "on", privacy: formData.get("privacy") === "on", marketing: formData.get("marketing") === "on" },
    });
  } catch (err) {
    if (err instanceof ConsentRequiredError) {
      return { fieldErrors: { terms: "Accept the terms and the privacy policy to create an account" } };
    }
    if (err instanceof APIError && err.status === "UNPROCESSABLE_ENTITY") {
      return { fieldErrors: { email: "An account with this email already exists. Sign in instead." } };
    }
    console.error("sign-up failed", err instanceof Error ? err.message : err);
    return { error: "We could not create your account. Please try again." };
  }
  redirect(safeNext(text(formData, "next")));
}

export async function signOutAction(): Promise<void> {
  await getAuth().api.signOut({ headers: await headers() });
  redirect("/");
}
