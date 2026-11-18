import { and, asc, eq, like, or, sql } from "drizzle-orm";
import { z } from "zod";
import { ForbiddenError } from "@/auth/session";
import { slugify } from "@/domain/menu/rules";
import { withRequestContext, type ContextOptions, type RequestContext, type Tx } from "./context";
import { attachGroups, readItems, type MenuItem } from "./menu";
import { auditLog, menuCategories, menuItems, modifierGroups, modifiers } from "./schema";

// Menu management for owners and managers. Every function checks the role first for a clear error, and
// row-level security independently refuses writes from anyone else. Each change writes to the audit log in
// the same transaction. Items and categories are archived (active = false), never deleted, so past orders and
// links keep working; groups and modifiers can be deleted because orders keep their own copy.

const name = z.string().trim().min(1, "Enter a name").max(120);
const description = z.string().trim().max(500).nullable().optional();
const minor = z.number().int().min(0).max(1_000_000_000_000);
const count = z.number().int().min(0).max(50);

const categoryCreate = z.object({ name });
const categoryPatch = z.object({ name: name.optional(), active: z.boolean().optional() });
const itemCreate = z.object({
  categoryId: z.uuid(),
  name,
  description,
  priceMinor: minor,
  available: z.boolean().optional(),
  active: z.boolean().optional(),
  imageKey: z.string().max(200).nullable().optional(),
});
const itemPatch = z.object({
  categoryId: z.uuid().optional(),
  name: name.optional(),
  description,
  priceMinor: minor.optional(),
  available: z.boolean().optional(),
  active: z.boolean().optional(),
  imageKey: z.string().max(200).nullable().optional(),
});
const groupInput = z
  .object({ name, minSelect: count, maxSelect: z.number().int().min(1).max(50) })
  .refine((g) => g.maxSelect >= g.minSelect, { path: ["maxSelect"], message: "The most choices cannot be fewer than the fewest" });
const groupPatch = z
  .object({ name: name.optional(), minSelect: count.optional(), maxSelect: z.number().int().min(1).max(50).optional() });
const modifierInput = z.object({ name, priceDeltaMinor: minor, available: z.boolean().optional() });
const modifierPatch = z.object({ name: name.optional(), priceDeltaMinor: minor.optional(), available: z.boolean().optional() });

function assertEditor(ctx: RequestContext): void {
  if (ctx.role !== "owner" && ctx.role !== "manager") throw new ForbiddenError("Only owners and managers can change the menu");
}

const defined = <T extends object>(o: T): Partial<T> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

const audit = (tx: Tx, ctx: RequestContext, action: string, targetId: string, meta: Record<string, unknown> = {}) =>
  tx.insert(auditLog).values({ actorId: ctx.userId, actorRole: ctx.role, action, targetType: "menu", targetId, meta });

/** A slug that no other row uses: the plain one, or with -2, -3 and so on. */
async function freeSlug(tx: Tx, table: typeof menuItems | typeof menuCategories, text: string): Promise<string> {
  const base = slugify(text);
  const taken = new Set(
    (await tx.select({ slug: table.slug }).from(table).where(or(eq(table.slug, base), like(table.slug, `${base}-%`)))).map((r) => r.slug),
  );
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

// ---------- reading ----------

export type AdminCategory = { id: string; slug: string; name: string; active: boolean; sortOrder: number; items: MenuItem[] };

/** The whole menu as staff see it: archived and sold-out items included. Read-only roles may call this too. */
export async function loadAdminMenu(ctx: RequestContext, opts?: ContextOptions): Promise<AdminCategory[]> {
  if (ctx.role === "customer") throw new ForbiddenError("Staff only");
  return withRequestContext(
    ctx,
    async (tx) => {
      const cats = await tx.select().from(menuCategories).orderBy(asc(menuCategories.sortOrder), asc(menuCategories.name), asc(menuCategories.id));
      const rows = await readItems(tx, undefined);
      const items = await attachGroups(tx, rows);
      return cats.map((c) => ({
        id: c.id,
        slug: c.slug,
        name: c.name,
        active: c.active,
        sortOrder: c.sortOrder,
        items: items.filter((i) => i.categoryId === c.id).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
      }));
    },
    opts,
  );
}

// ---------- categories ----------

export async function createCategory(ctx: RequestContext, input: z.input<typeof categoryCreate>, opts?: ContextOptions): Promise<{ id: string; slug: string }> {
  assertEditor(ctx);
  const data = categoryCreate.parse(input);
  return withRequestContext(
    ctx,
    async (tx) => {
      const [{ next }] = await tx.select({ next: sql<number>`coalesce(max(${menuCategories.sortOrder}), -1) + 1` }).from(menuCategories);
      const slug = await freeSlug(tx, menuCategories, data.name);
      const [row] = await tx.insert(menuCategories).values({ name: data.name, slug, sortOrder: Number(next) }).returning({ id: menuCategories.id, slug: menuCategories.slug });
      await audit(tx, ctx, "menu.category.create", row.id, { name: data.name });
      return row;
    },
    opts,
  );
}

export async function updateCategory(ctx: RequestContext, id: string, patch: z.input<typeof categoryPatch>, opts?: ContextOptions): Promise<void> {
  assertEditor(ctx);
  const data = defined(categoryPatch.parse(patch));
  return withRequestContext(
    ctx,
    async (tx) => {
      if (Object.keys(data).length === 0) return;
      await tx.update(menuCategories).set(data).where(eq(menuCategories.id, id));
      await audit(tx, ctx, "menu.category.update", id, { fields: Object.keys(data) });
    },
    opts,
  );
}

async function renumber(tx: Tx, ids: string[], table: typeof menuCategories | typeof menuItems): Promise<void> {
  for (let i = 0; i < ids.length; i++) await tx.update(table).set({ sortOrder: i }).where(eq(table.id, ids[i]));
}
const swap = <T>(list: T[], i: number, dir: "up" | "down"): T[] => {
  const j = dir === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
};

export async function moveCategory(ctx: RequestContext, id: string, dir: "up" | "down", opts?: ContextOptions): Promise<void> {
  assertEditor(ctx);
  return withRequestContext(
    ctx,
    async (tx) => {
      const ids = (await tx.select({ id: menuCategories.id }).from(menuCategories).orderBy(asc(menuCategories.sortOrder), asc(menuCategories.name), asc(menuCategories.id))).map((r) => r.id);
      const i = ids.indexOf(id);
      if (i === -1) return;
      await renumber(tx, swap(ids, i, dir), menuCategories);
    },
    opts,
  );
}

// ---------- items ----------

export async function createItem(ctx: RequestContext, input: z.input<typeof itemCreate>, opts?: ContextOptions): Promise<{ id: string; slug: string }> {
  assertEditor(ctx);
  const data = itemCreate.parse(input);
  return withRequestContext(
    ctx,
    async (tx) => {
      const [{ next }] = await tx
        .select({ next: sql<number>`coalesce(max(${menuItems.sortOrder}), -1) + 1` })
        .from(menuItems)
        .where(eq(menuItems.categoryId, data.categoryId));
      const slug = await freeSlug(tx, menuItems, data.name);
      const [row] = await tx
        .insert(menuItems)
        .values({ ...defined(data), categoryId: data.categoryId, name: data.name, priceMinor: data.priceMinor, slug, sortOrder: Number(next) })
        .returning({ id: menuItems.id, slug: menuItems.slug });
      await audit(tx, ctx, "menu.item.create", row.id, { name: data.name, priceMinor: data.priceMinor });
      return row;
    },
    opts,
  );
}

export async function updateItem(ctx: RequestContext, id: string, patch: z.input<typeof itemPatch>, opts?: ContextOptions): Promise<void> {
  assertEditor(ctx);
  const data = defined(itemPatch.parse(patch));
  return withRequestContext(
    ctx,
    async (tx) => {
      if (Object.keys(data).length === 0) return;
      await tx.update(menuItems).set(data).where(eq(menuItems.id, id));
      await audit(tx, ctx, "menu.item.update", id, { fields: Object.keys(data) });
    },
    opts,
  );
}

/** The quick sold-out switch. */
export const setItemAvailable = async (ctx: RequestContext, id: string, available: boolean, opts?: ContextOptions) => updateItem(ctx, id, { available }, opts);

export async function moveItem(ctx: RequestContext, id: string, dir: "up" | "down", opts?: ContextOptions): Promise<void> {
  assertEditor(ctx);
  return withRequestContext(
    ctx,
    async (tx) => {
      const [item] = await tx.select({ categoryId: menuItems.categoryId }).from(menuItems).where(eq(menuItems.id, id));
      if (!item) return;
      const ids = (
        await tx.select({ id: menuItems.id }).from(menuItems).where(eq(menuItems.categoryId, item.categoryId)).orderBy(asc(menuItems.sortOrder), asc(menuItems.name), asc(menuItems.id))
      ).map((r) => r.id);
      const i = ids.indexOf(id);
      if (i === -1) return;
      await renumber(tx, swap(ids, i, dir), menuItems);
    },
    opts,
  );
}

// ---------- groups and modifiers ----------

export async function createGroup(ctx: RequestContext, itemId: string, input: z.input<typeof groupInput>, opts?: ContextOptions): Promise<{ id: string }> {
  assertEditor(ctx);
  const data = groupInput.parse(input);
  return withRequestContext(
    ctx,
    async (tx) => {
      const [{ next }] = await tx.select({ next: sql<number>`coalesce(max(${modifierGroups.sortOrder}), -1) + 1` }).from(modifierGroups).where(eq(modifierGroups.itemId, itemId));
      const [row] = await tx.insert(modifierGroups).values({ itemId, ...data, sortOrder: Number(next) }).returning({ id: modifierGroups.id });
      await audit(tx, ctx, "menu.group.create", row.id, { itemId, name: data.name });
      return row;
    },
    opts,
  );
}

export async function updateGroup(ctx: RequestContext, id: string, patch: z.input<typeof groupPatch>, opts?: ContextOptions): Promise<void> {
  assertEditor(ctx);
  const data = defined(groupPatch.parse(patch));
  return withRequestContext(
    ctx,
    async (tx) => {
      if (Object.keys(data).length === 0) return;
      const [current] = await tx.select().from(modifierGroups).where(eq(modifierGroups.id, id));
      if (!current) return;
      const merged = groupInput.safeParse({ name: current.name, minSelect: current.minSelect, maxSelect: current.maxSelect, ...data });
      if (!merged.success) throw merged.error;
      await tx.update(modifierGroups).set(data).where(eq(modifierGroups.id, id));
      await audit(tx, ctx, "menu.group.update", id, { fields: Object.keys(data) });
    },
    opts,
  );
}

export async function deleteGroup(ctx: RequestContext, id: string, opts?: ContextOptions): Promise<void> {
  assertEditor(ctx);
  return withRequestContext(
    ctx,
    async (tx) => {
      await tx.delete(modifierGroups).where(eq(modifierGroups.id, id));
      await audit(tx, ctx, "menu.group.delete", id);
    },
    opts,
  );
}

export async function createModifier(ctx: RequestContext, groupId: string, input: z.input<typeof modifierInput>, opts?: ContextOptions): Promise<{ id: string }> {
  assertEditor(ctx);
  const data = modifierInput.parse(input);
  return withRequestContext(
    ctx,
    async (tx) => {
      const [{ next }] = await tx.select({ next: sql<number>`coalesce(max(${modifiers.sortOrder}), -1) + 1` }).from(modifiers).where(eq(modifiers.groupId, groupId));
      const [row] = await tx.insert(modifiers).values({ groupId, ...defined(data), name: data.name, priceDeltaMinor: data.priceDeltaMinor, sortOrder: Number(next) }).returning({ id: modifiers.id });
      await audit(tx, ctx, "menu.modifier.create", row.id, { groupId, name: data.name });
      return row;
    },
    opts,
  );
}

export async function updateModifier(ctx: RequestContext, id: string, patch: z.input<typeof modifierPatch>, opts?: ContextOptions): Promise<void> {
  assertEditor(ctx);
  const data = defined(modifierPatch.parse(patch));
  return withRequestContext(
    ctx,
    async (tx) => {
      if (Object.keys(data).length === 0) return;
      await tx.update(modifiers).set(data).where(eq(modifiers.id, id));
      await audit(tx, ctx, "menu.modifier.update", id, { fields: Object.keys(data) });
    },
    opts,
  );
}

export async function deleteModifier(ctx: RequestContext, id: string, opts?: ContextOptions): Promise<void> {
  assertEditor(ctx);
  return withRequestContext(
    ctx,
    async (tx) => {
      await tx.delete(modifiers).where(and(eq(modifiers.id, id)));
      await audit(tx, ctx, "menu.modifier.delete", id);
    },
    opts,
  );
}
