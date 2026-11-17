"use server";

import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { ActiveOrderError, deleteCustomerAccount } from "@/account/delete";
import { setMarketingConsent, updateProfile } from "@/account/profile";
import { getIdentity } from "@/auth/customer";
import { echo, fieldErrors, text, type FormState } from "@/lib/form";

async function customer() {
  const identity = await getIdentity();
  if (!identity || identity.ctx.role !== "customer") redirect("/sign-in?next=%2Faccount");
  return identity;
}

export async function updateProfileAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { ctx } = await customer();
  try {
    await updateProfile(ctx, { fullName: text(formData, "fullName"), phone: text(formData, "phone") });
  } catch (err) {
    if (err instanceof ZodError) {
      const errors = fieldErrors(err);
      return { fieldErrors: { fullName: errors.fullName ?? "", phone: errors.phone ?? "" }, values: echo(formData, ["fullName", "phone"]) };
    }
    throw err;
  }
  return { fieldErrors: { saved: "Saved" }, values: echo(formData, ["fullName", "phone"]) };
}

export async function setMarketingAction(formData: FormData): Promise<void> {
  const { ctx } = await customer();
  await setMarketingConsent(ctx, text(formData, "marketing") === "on");
  redirect("/account");
}

export async function deleteAccountAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const { ctx } = await customer();
  const values = echo(formData, ["confirm"]);
  if (values.confirm !== "on") return { fieldErrors: { confirm: "Tick the box to confirm" }, values };
  try {
    await deleteCustomerAccount(ctx);
  } catch (err) {
    if (err instanceof ActiveOrderError) return { error: err.message, values };
    throw err;
  }
  redirect("/?account=deleted");
}
