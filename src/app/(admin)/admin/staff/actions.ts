"use server";

import { APIError } from "better-auth/api";
import { ZodError } from "zod";
import { requireStaff } from "@/auth/customer";
import { ForbiddenError } from "@/auth/session";
import { blockStaff, changeStaffRole, createStaffUser, sendStaffPasswordReset, unblockStaff } from "@/auth/staff";
import type { RequestContext } from "@/db/context";
import { text } from "@/lib/form";
import { redirectWith } from "@/lib/notice";

const PATH = "/admin/staff";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function describe(err: unknown): string {
  if (err instanceof ForbiddenError) return err.message;
  if (err instanceof ZodError) {
    const field = String(err.issues[0]?.path[0] ?? "");
    return field === "email" ? "Enter a valid email address." : field === "temporaryPassword" ? "The temporary password needs at least 8 characters." : field === "name" ? "Enter a name." : "Check the details and try again.";
  }
  if (err instanceof APIError) return "An account with that email already exists.";
  throw err;
}

/** Owners only. Runs one staff change and comes back with a message. */
async function act(fn: (ctx: RequestContext) => Promise<string>): Promise<never> {
  const { ctx } = await requireStaff(["owner"], PATH);
  let notice: string;
  try {
    notice = await fn(ctx);
  } catch (err) {
    redirectWith(PATH, { error: describe(err) });
  }
  redirectWith(PATH, { notice });
}

const target = (form: FormData): string => {
  const v = text(form, "id");
  if (!UUID.test(v)) throw new ForbiddenError("That person could not be found.");
  return v;
};

export async function createStaffAction(form: FormData): Promise<void> {
  await act(async (ctx) => {
    await createStaffUser(ctx, {
      name: text(form, "name"),
      email: text(form, "email"),
      role: text(form, "role") as "owner" | "manager" | "kitchen",
      temporaryPassword: text(form, "temporaryPassword"),
    });
    return "Staff member added. Give them the temporary password and ask them to change it.";
  });
}

export async function changeRoleAction(form: FormData): Promise<void> {
  await act(async (ctx) => {
    await changeStaffRole(ctx, target(form), text(form, "role") as "owner" | "manager" | "kitchen");
    return "Role changed.";
  });
}

export async function setBlockedAction(form: FormData): Promise<void> {
  await act(async (ctx) => {
    const block = text(form, "blocked") === "true";
    await (block ? blockStaff : unblockStaff)(ctx, target(form));
    return block ? "Blocked. They are signed out and cannot sign in." : "Unblocked.";
  });
}

export async function sendResetAction(form: FormData): Promise<void> {
  await act(async (ctx) => {
    await sendStaffPasswordReset(ctx, target(form));
    return "A password reset link has been emailed.";
  });
}
