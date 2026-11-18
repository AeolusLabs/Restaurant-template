"use server";

import { ZodError } from "zod";
import { restaurantConfig } from "../../../../../config/restaurant";
import { ForbiddenError } from "@/auth/session";
import { requireStaff } from "@/auth/customer";
import type { RequestContext } from "@/db/context";
import { removeItemImage, setItemImage } from "@/db/item-image";
import * as menu from "@/db/menu-admin";
import { ImageError } from "@/lib/image-upload";
import { parseMoneyInput } from "@/lib/money";
import { echo, text } from "@/lib/form";
import { redirectWith } from "@/lib/notice";
import { providers } from "@/providers";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MENU = "/admin/menu";
const itemPath = (id: string) => `${MENU}/items/${id}`;
const PRICE_HELP = "Enter a price like 3500 or 3500.50";

class InputError extends Error {}

function describe(err: unknown): string {
  if (err instanceof InputError || err instanceof ImageError || err instanceof ForbiddenError) return err.message;
  if (err instanceof ZodError) return err.issues[0]?.message && err.issues[0].message !== "Invalid input" ? err.issues[0].message : "Check the details and try again.";
  throw err;
}

/** Checks who is asking, runs the change, and comes back to the screen with a message. */
async function act(path: string, fn: (ctx: RequestContext) => Promise<{ notice: string; to?: string }>, values?: Record<string, string>): Promise<never> {
  const { ctx } = await requireStaff(["owner", "manager"], path);
  let result: { notice: string; to?: string };
  try {
    result = await fn(ctx);
  } catch (err) {
    redirectWith(path, { error: describe(err), values });
  }
  redirectWith(result.to ?? path, { notice: result.notice });
}

const id = (form: FormData, key: string): string => {
  const v = text(form, key);
  if (!UUID.test(v)) throw new InputError("That item could not be found.");
  return v;
};
const price = (form: FormData, key: string): number => {
  const v = parseMoneyInput(text(form, key), restaurantConfig.currency.exponent);
  if (v === null) throw new InputError(PRICE_HELP);
  return v;
};
const whole = (form: FormData, key: string, label: string): number => {
  const n = Number(text(form, key));
  if (!Number.isInteger(n) || n < 0) throw new InputError(`${label} must be a whole number`);
  return n;
};
const on = (form: FormData, key: string) => text(form, key) === "on";

// ---------- categories ----------

export async function createCategoryAction(form: FormData): Promise<void> {
  await act(MENU, async (ctx) => {
    await menu.createCategory(ctx, { name: text(form, "name") });
    return { notice: "Category added." };
  });
}
export async function setCategoryActiveAction(form: FormData): Promise<void> {
  await act(MENU, async (ctx) => {
    const on = text(form, "active") === "true";
    await menu.updateCategory(ctx, id(form, "id"), { active: on });
    return { notice: on ? "Category is shown on the menu again." : "Category hidden from the menu." };
  });
}
export async function moveCategoryAction(form: FormData): Promise<void> {
  await act(MENU, async (ctx) => {
    await menu.moveCategory(ctx, id(form, "id"), text(form, "dir") === "up" ? "up" : "down");
    return { notice: "Moved." };
  });
}

// ---------- items ----------

export async function createItemAction(form: FormData): Promise<void> {
  await act(
    `${MENU}/items/new`,
    async (ctx) => {
    const created = await menu.createItem(ctx, {
      categoryId: text(form, "categoryId"),
      name: text(form, "name"),
      description: text(form, "description") || null,
      priceMinor: price(form, "price"),
    });
    return { notice: "Item added. You can now add a photo and choices.", to: itemPath(created.id) };
    },
    echo(form, ["categoryId", "name", "description", "price"]),
  );
}

export async function setItemAvailableAction(form: FormData): Promise<void> {
  await act(MENU, async (ctx) => {
    const available = text(form, "available") === "true";
    await menu.setItemAvailable(ctx, id(form, "id"), available);
    return { notice: available ? "Back in stock." : "Marked as sold out." };
  });
}
export async function moveItemAction(form: FormData): Promise<void> {
  await act(MENU, async (ctx) => {
    await menu.moveItem(ctx, id(form, "id"), text(form, "dir") === "up" ? "up" : "down");
    return { notice: "Moved." };
  });
}

export async function updateItemAction(form: FormData): Promise<void> {
  const itemId = text(form, "id");
  await act(
    itemPath(itemId),
    async (ctx) => {
    await menu.updateItem(ctx, id(form, "id"), {
      name: text(form, "name"),
      description: text(form, "description") || null,
      priceMinor: price(form, "price"),
      categoryId: text(form, "categoryId"),
      available: on(form, "available"),
      active: on(form, "active"),
    });
    return { notice: "Saved." };
    },
    echo(form, ["name", "description", "price", "categoryId", "available", "active"]),
  );
}

export async function uploadImageAction(form: FormData): Promise<void> {
  const itemId = text(form, "id");
  await act(itemPath(itemId), async (ctx) => {
    const file = form.get("image");
    if (!(file instanceof File) || file.size === 0) throw new ImageError("empty", "Choose a picture to upload");
    await setItemImage(ctx, id(form, "id"), new Uint8Array(await file.arrayBuffer()), providers().storage);
    return { notice: "Photo saved." };
  });
}

export async function removeImageAction(form: FormData): Promise<void> {
  const itemId = text(form, "id");
  await act(itemPath(itemId), async (ctx) => {
    await removeItemImage(ctx, id(form, "id"), providers().storage);
    return { notice: "Photo removed." };
  });
}

// ---------- choices ----------

export async function createGroupAction(form: FormData): Promise<void> {
  const itemId = text(form, "itemId");
  await act(itemPath(itemId), async (ctx) => {
    await menu.createGroup(ctx, id(form, "itemId"), { name: text(form, "name"), minSelect: whole(form, "min", "The fewest choices"), maxSelect: whole(form, "max", "The most choices") });
    return { notice: "Choice group added. Now add the choices." };
  });
}
export async function updateGroupAction(form: FormData): Promise<void> {
  const itemId = text(form, "itemId");
  await act(itemPath(itemId), async (ctx) => {
    await menu.updateGroup(ctx, id(form, "id"), { name: text(form, "name"), minSelect: whole(form, "min", "The fewest choices"), maxSelect: whole(form, "max", "The most choices") });
    return { notice: "Group saved." };
  });
}
export async function deleteGroupAction(form: FormData): Promise<void> {
  const itemId = text(form, "itemId");
  await act(itemPath(itemId), async (ctx) => {
    await menu.deleteGroup(ctx, id(form, "id"));
    return { notice: "Group deleted." };
  });
}
export async function createModifierAction(form: FormData): Promise<void> {
  const itemId = text(form, "itemId");
  await act(itemPath(itemId), async (ctx) => {
    await menu.createModifier(ctx, id(form, "groupId"), { name: text(form, "name"), priceDeltaMinor: price(form, "price"), available: true });
    return { notice: "Choice added." };
  });
}
export async function updateModifierAction(form: FormData): Promise<void> {
  const itemId = text(form, "itemId");
  await act(itemPath(itemId), async (ctx) => {
    await menu.updateModifier(ctx, id(form, "id"), { name: text(form, "name"), priceDeltaMinor: price(form, "price"), available: on(form, "available") });
    return { notice: "Choice saved." };
  });
}
export async function deleteModifierAction(form: FormData): Promise<void> {
  const itemId = text(form, "itemId");
  await act(itemPath(itemId), async (ctx) => {
    await menu.deleteModifier(ctx, id(form, "id"));
    return { notice: "Choice deleted." };
  });
}
