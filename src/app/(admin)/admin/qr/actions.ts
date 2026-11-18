"use server";

import { requireStaff } from "@/auth/customer";
import { ForbiddenError } from "@/auth/session";
import { QrInputError, QrNotFoundError, createQrSource, renameQrSource, setQrActive } from "@/db/qr-admin";
import { text } from "@/lib/form";
import { redirectWith } from "@/lib/notice";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIST = "/admin/qr";

function describe(err: unknown): string {
  if (err instanceof QrInputError || err instanceof QrNotFoundError || err instanceof ForbiddenError) return err.message;
  throw err;
}

export async function createQrAction(form: FormData): Promise<void> {
  const { ctx } = await requireStaff(["owner", "manager"], LIST);
  const label = text(form, "label");
  let id: string;
  try {
    ({ id } = await createQrSource(ctx, label));
  } catch (err) {
    redirectWith(LIST, { error: describe(err), values: { label } });
  }
  redirectWith(`${LIST}/${id}`, { notice: "QR code made. Print it or download it below." });
}

export async function renameQrAction(form: FormData): Promise<void> {
  const id = text(form, "id");
  if (!UUID.test(id)) redirectWith(LIST, { error: "That QR code could not be found." });
  const here = `${LIST}/${id}`;
  const { ctx } = await requireStaff(["owner", "manager"], here);
  try {
    await renameQrSource(ctx, id, text(form, "label"));
  } catch (err) {
    redirectWith(here, { error: describe(err) });
  }
  redirectWith(here, { notice: "Name saved. The printed code is unchanged." });
}

export async function setQrActiveAction(form: FormData): Promise<void> {
  const id = text(form, "id");
  if (!UUID.test(id)) redirectWith(LIST, { error: "That QR code could not be found." });
  const here = `${LIST}/${id}`;
  const { ctx } = await requireStaff(["owner", "manager"], here);
  const active = text(form, "active") === "true";
  try {
    await setQrActive(ctx, id, active);
  } catch (err) {
    redirectWith(here, { error: describe(err) });
  }
  redirectWith(here, { notice: active ? "Switched on. Scans are counted again." : "Switched off. Scans still open the menu, but are no longer counted or credited with orders." });
}
