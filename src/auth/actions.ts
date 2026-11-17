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

const emailSchema = z.object({ email: z.email("Enter a valid email") });
const resetSchema = z
  .object({
    token: z.string().min(1),
    password: z.string().min(8, "Use at least 8 characters").max(128),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "The two passwords are not the same" });

/**
 * Sends a password reset link. The answer is the same whether or not the address has an account, so this
 * cannot be used to find out who is a customer.
 */
export async function requestResetAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = echo(formData, ["email"]);
  const parsed = emailSchema.safeParse({ email: text(formData, "email") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error), values };
  if (!(await passesHumanCheck(formData))) return { error: HUMAN_CHECK_FAILED, values };

  try {
    await getAuth().api.requestPasswordReset({ body: { email: parsed.data.email, redirectTo: "/reset-password" } });
  } catch (err) {
    // Not shown to the visitor: a different answer for "could not send" would also reveal the account exists.
    console.error("password reset request failed:", err instanceof Error ? err.message : err);
  }
  return { message: "If an account uses that email address, we have sent a link to choose a new password. It works once and expires in 1 hour.", values };
}

export async function resetPasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = resetSchema.safeParse({ token: text(formData, "token"), password: text(formData, "password"), confirm: text(formData, "confirm") });
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };

  try {
    await getAuth().api.resetPassword({ body: { newPassword: parsed.data.password, token: parsed.data.token } });
  } catch (err) {
    if (err instanceof APIError) return { error: "This link has expired or has already been used. Ask for a new one." };
    throw err;
  }
  redirect("/sign-in?reset=1");
}
