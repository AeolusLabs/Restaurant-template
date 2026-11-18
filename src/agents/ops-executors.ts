import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { raiseAlert } from "@/db/alerts";
import { auditLog, menuItems, orders, profiles } from "@/db/schema";
import type { Executor } from "./types";

// What the operations agents' proposals do once they are decided. Each is small, reversible by a person, and
// checked again at the moment it runs.

export const NOTE_KIND = "insight.note";
export const ARCHIVE_KIND = "menu.archive_item";
export const ALERT_KIND = "alert.raise";
export const BLOCK_KIND = "customer.block";

const note = z.object({ title: z.string().min(1).max(200), detail: z.string().min(1).max(1000) });
export type NotePayload = z.infer<typeof note>;
const archive = z.object({ itemId: z.uuid(), name: z.string().min(1).max(200), reason: z.string().max(300) });
export type ArchivePayload = z.infer<typeof archive>;
const alert = z.object({ kind: z.enum(["delivery_stuck", "anomaly"]), orderCode: z.string().max(12).nullable(), detail: z.string().min(1).max(400) });
export type AlertPayload = z.infer<typeof alert>;
const block = z.object({ profileId: z.uuid(), name: z.string().max(200), reason: z.string().min(1).max(400) });
export type BlockPayload = z.infer<typeof block>;

/** Reading a note is the whole action: approving records that someone saw it. */
export const noteExecutor: Executor<NotePayload> = { kind: NOTE_KIND, payloadSchema: note, execute: async () => ({ acknowledged: true }) };

/** Hides a dish from the menu. It can be shown again from Admin, Menu. */
export const archiveExecutor: Executor<ArchivePayload> = {
  kind: ARCHIVE_KIND,
  payloadSchema: archive,
  async execute(p, _deps, tx) {
    const done = await tx.update(menuItems).set({ active: false }).where(and(eq(menuItems.id, p.itemId), eq(menuItems.active, true))).returning({ id: menuItems.id });
    if (done.length > 0) await tx.insert(auditLog).values({ actorRole: "system", action: "menu.item.hidden_by_agent", targetType: "menu_item", targetId: p.itemId, meta: { name: p.name, reason: p.reason } });
    return { hidden: done.length > 0 };
  },
};

export const alertExecutor: Executor<AlertPayload> = {
  kind: ALERT_KIND,
  payloadSchema: alert,
  async execute(p, _deps, tx) {
    const [order] = p.orderCode ? await tx.select({ id: orders.id }).from(orders).where(eq(orders.publicCode, p.orderCode)) : [];
    await raiseAlert(tx, { kind: p.kind, severity: "warning", orderId: order?.id, payload: { detail: p.detail, orderCode: p.orderCode } });
    return { alerted: true };
  },
};

/** Blocks a customer: they can no longer sign in or order. Only a customer who is not already blocked. */
export const blockExecutor: Executor<BlockPayload> = {
  kind: BLOCK_KIND,
  payloadSchema: block,
  async execute(p, _deps, tx) {
    const done = await tx
      .update(profiles)
      .set({ blockedAt: new Date() })
      .where(and(eq(profiles.id, p.profileId), eq(profiles.role, "customer"), isNull(profiles.blockedAt), isNull(profiles.deletedAt)))
      .returning({ id: profiles.id });
    if (done.length === 0) throw new Error("Not blocked: that is not an active customer who is still allowed to order");
    await tx.insert(auditLog).values({ actorRole: "system", action: "profile.block", targetType: "profile", targetId: p.profileId, meta: { reason: p.reason, by: "agent" } });
    return { blocked: true };
  },
};
