import { eq } from "drizzle-orm";
import { ForbiddenError } from "@/auth/session";
import { prepareImage } from "@/lib/image-upload";
import type { StorageProvider } from "@/providers/storage/types";
import { withRequestContext, type ContextOptions, type RequestContext } from "./context";
import { updateItem } from "./menu-admin";
import { menuItems } from "./schema";

async function currentKey(ctx: RequestContext, itemId: string, opts?: ContextOptions): Promise<string | null> {
  const [row] = await withRequestContext(ctx, (tx) => tx.select({ key: menuItems.imageKey }).from(menuItems).where(eq(menuItems.id, itemId)), opts);
  return row?.key ?? null;
}

/**
 * Stores a new picture for an item and removes the old one. The upload is checked before anything is written,
 * the new file is stored before the item points at it, and the old file is deleted last, so a failure at any
 * step never leaves an item pointing at a missing file.
 */
export async function setItemImage(ctx: RequestContext, itemId: string, bytes: Uint8Array, storage: StorageProvider, opts?: ContextOptions): Promise<string> {
  if (ctx.role !== "owner" && ctx.role !== "manager") throw new ForbiddenError("Only owners and managers can change the menu");
  const image = prepareImage(bytes);
  const old = await currentKey(ctx, itemId, opts);
  await storage.put(image.key, image.bytes, image.contentType);
  try {
    await updateItem(ctx, itemId, { imageKey: image.key }, opts);
  } catch (err) {
    await storage.delete(image.key);
    throw err;
  }
  if (old) await storage.delete(old).catch(() => undefined);
  return image.key;
}

export async function removeItemImage(ctx: RequestContext, itemId: string, storage: StorageProvider, opts?: ContextOptions): Promise<void> {
  if (ctx.role !== "owner" && ctx.role !== "manager") throw new ForbiddenError("Only owners and managers can change the menu");
  const old = await currentKey(ctx, itemId, opts);
  await updateItem(ctx, itemId, { imageKey: null }, opts);
  if (old) await storage.delete(old).catch(() => undefined);
}
