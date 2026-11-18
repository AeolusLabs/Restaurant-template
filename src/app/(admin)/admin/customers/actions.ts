"use server";

import { requireStaff } from "@/auth/customer";
import { ForbiddenError } from "@/auth/session";
import { blockCustomer, unblockCustomer } from "@/auth/staff";
import { text } from "@/lib/form";
import { redirectWith } from "@/lib/notice";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Blocks or unblocks a customer. A blocked person cannot sign in or order; their past orders are untouched. */
export async function setCustomerBlockedAction(form: FormData): Promise<void> {
  const id = text(form, "id");
  if (!UUID.test(id)) redirectWith("/admin/customers", { error: "That customer could not be found." });
  const here = `/admin/customers/${id}`;
  const { ctx } = await requireStaff(["owner", "manager"], here);
  const block = text(form, "blocked") === "true";
  try {
    await (block ? blockCustomer(ctx, id) : unblockCustomer(ctx, id));
  } catch (err) {
    if (err instanceof ForbiddenError) redirectWith(here, { error: err.message });
    throw err;
  }
  redirectWith(here, { notice: block ? "Customer blocked. They can no longer sign in or order." : "Customer unblocked." });
}
