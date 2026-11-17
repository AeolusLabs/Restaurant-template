"use server";

import { APIError } from "better-auth/api";
import { sql } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { withSystemContext } from "@/db/context";
import { echo, fieldErrors, text, type FormState } from "@/lib/form";
import { HUMAN_CHECK_FAILED, passesHumanCheck } from "@/lib/human-check";
import { safeNext } from "@/lib/safe-redirect";
import { getAuth } from "./auth";
import { ConsentRequiredError, signUpCustomer } from "./signup";

const signInSchema = z.object({ email: z.email("Enter a valid email"), password: z.string().min(1, "Enter your password") });
const signUpSchema = z.object({
  name: z.string().trim().min(1, "Enter your name").max(200),
  email: z.email("Enter a valid email"),
  password: z.string().min(8, "Use at least 8 characters").max(128),
});

export async function signInAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = echo(formData, ["email"]);
  const parsed = signInSchema.safeParse({ email: text(formData, "email"), password: text(formData, "password") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  const { email, password } = parsed.data;
  if (!(await passesHumanCheck(formData))) return { error: HUMAN_CHECK_FAILED, values };

  // Say plainly when an account has been blocked, instead of a password error that never goes away.
  const { rows } = await withSystemContext((tx) =>
    tx.execute(sql`select p.blocked_at, p.deleted_at from "user" u join profiles p on p.id = u.id where u.email = ${email.toLowerCase()}`),
  );
  if (rows[0]?.blocked_at || rows[0]?.deleted_at) {
    return { error: "This account cannot sign in. Please contact the restaurant.", values };
  }

  try {
    await getAuth().api.signInEmail({ body: { email, password }, headers: await headers() });
  } catch (err) {
    if (err instanceof APIError) return { error: "The email or password is not right.", values };
    throw err;
  }
  redirect(safeNext(text(formData, "next")));
}

export async function signUpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = echo(formData, ["name", "email", "terms", "privacy", "marketing"]);
  const parsed = signUpSchema.safeParse({ name: text(formData, "name"), email: text(formData, "email"), password: text(formData, "password") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  if (!(await passesHumanCheck(formData))) return { error: HUMAN_CHECK_FAILED, values };

  try {
    await signUpCustomer({
      ...parsed.data,
      // Checkboxes only send a value when ticked. Nothing is ticked for the customer.
      consent: { terms: formData.get("terms") === "on", privacy: formData.get("privacy") === "on", marketing: formData.get("marketing") === "on" },
    });
  } catch (err) {
    if (err instanceof ConsentRequiredError) {
      return { fieldErrors: { terms: "Accept the terms and the privacy policy to create an account" }, values };
    }
    if (err instanceof APIError && err.status === "UNPROCESSABLE_ENTITY") {
      return { fieldErrors: { email: "An account with this email already exists. Sign in instead." }, values };
    }
    console.error("sign-up failed", err instanceof Error ? err.message : err);
    return { error: "We could not create your account. Please try again.", values };
  }
  redirect(safeNext(text(formData, "next")));
}

export async function signOutAction(): Promise<void> {
  await getAuth().api.signOut({ headers: await headers() });
  redirect("/");
}
