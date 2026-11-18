"use server";

import { requireStaff } from "@/auth/customer";
import { resolveAlert } from "@/db/alerts";
import { text } from "@/lib/form";
import { redirectWith } from "@/lib/notice";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Marks an alert as dealt with. */
export async function resolveAlertAction(formData: FormData): Promise<void> {
  const id = text(formData, "id");
  const { ctx } = await requireStaff(["owner", "manager"], "/admin");
  if (!UUID.test(id)) redirectWith("/admin", { error: "That alert could not be found." });
  const done = await resolveAlert(ctx, id);
  redirectWith("/admin", done ? { notice: "Marked as dealt with." } : { error: "That alert was already dealt with." });
}
