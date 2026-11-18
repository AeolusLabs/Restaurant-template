"use server";

import { restaurantConfig } from "../../../../../config/restaurant";
import { requireStaff } from "@/auth/customer";
import { ForbiddenError } from "@/auth/session";
import { PromoCodeTakenError, PromoNotFoundError, createPromo, setPromoActive, updatePromo } from "@/db/promos-admin";
import { parsePromoForm, type PromoFormValues } from "@/domain/promos/form";
import { text } from "@/lib/form";
import { redirectWith } from "@/lib/notice";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIST = "/admin/promos";

const FIELD_LABEL: Record<string, string> = {
  code: "Code",
  description: "Description",
  kind: "Type",
  percent: "Percentage",
  amount: "Amount",
  minOrder: "Minimum order",
  maxDiscount: "Cap",
  startsAt: "Starts",
  expiresAt: "Ends",
  maxRedemptions: "Total uses",
  maxPerCustomer: "Uses per customer",
};

const KEYS = ["code", "description", "kind", "percent", "amount", "minOrder", "maxDiscount", "startsAt", "expiresAt", "maxRedemptions", "maxPerCustomer", "active"] as const;
const read = (form: FormData): PromoFormValues => Object.fromEntries(KEYS.map((k) => [k, text(form, k)])) as PromoFormValues;

/** The form as typed, checked. On a problem the person is sent back with every message and what they typed. */
function checked(form: FormData, back: string) {
  const values = read(form);
  const parsed = parsePromoForm(values, { exponent: restaurantConfig.currency.exponent, timeZone: restaurantConfig.timezone });
  if (!parsed.ok) {
    const error = Object.entries(parsed.errors)
      .map(([k, m]) => `${FIELD_LABEL[k] ?? k}: ${m}`)
      .join(". ");
    redirectWith(back, { error, values });
  }
  return { fields: parsed.fields, values };
}

function describe(err: unknown): string {
  if (err instanceof PromoCodeTakenError || err instanceof PromoNotFoundError || err instanceof ForbiddenError) return err.message;
  throw err;
}

export async function createPromoAction(form: FormData): Promise<void> {
  const { ctx } = await requireStaff(["owner", "manager"], `${LIST}/new`);
  const { fields, values } = checked(form, `${LIST}/new`);
  try {
    await createPromo(ctx, fields);
  } catch (err) {
    redirectWith(`${LIST}/new`, { error: describe(err), values });
  }
  redirectWith(LIST, { notice: `Promo ${fields.code} created.` });
}

export async function updatePromoAction(form: FormData): Promise<void> {
  const id = text(form, "id");
  if (!UUID.test(id)) redirectWith(LIST, { error: "That promo could not be found." });
  const here = `${LIST}/${id}`;
  const { ctx } = await requireStaff(["owner", "manager"], here);
  const { fields, values } = checked(form, here);
  try {
    await updatePromo(ctx, id, fields);
  } catch (err) {
    redirectWith(here, { error: describe(err), values });
  }
  redirectWith(LIST, { notice: `Promo ${fields.code} saved.` });
}

export async function setPromoActiveAction(form: FormData): Promise<void> {
  const id = text(form, "id");
  if (!UUID.test(id)) redirectWith(LIST, { error: "That promo could not be found." });
  const { ctx } = await requireStaff(["owner", "manager"], LIST);
  const active = text(form, "active") === "true";
  try {
    await setPromoActive(ctx, id, active);
  } catch (err) {
    redirectWith(LIST, { error: describe(err) });
  }
  redirectWith(LIST, { notice: active ? "Promo switched on." : "Promo switched off. Customers can no longer use it." });
}
