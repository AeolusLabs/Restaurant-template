import { sql } from "drizzle-orm";
import { z } from "zod";
import { withRequestContext, withSystemContext, type RequestContext } from "@/db/context";
import { auditLog, profiles } from "@/db/schema";
import { getAuth } from "./auth";
import { ForbiddenError, requireRole, type AuthDeps } from "./session";
import { removeAuthUser } from "./signup";

const staffSchema = z.object({
  email: z.email(),
  name: z.string().trim().min(1).max(200),
  role: z.enum(["owner", "manager", "kitchen"]),
  temporaryPassword: z.string().min(8).max(128),
});
export type StaffInput = z.input<typeof staffSchema>;

/** Owner only. Staff roles are never reachable through customer sign-up. */
export async function createStaffUser(actor: RequestContext, input: StaffInput, deps: AuthDeps = {}): Promise<{ userId: string }> {
  requireRole(actor, ["owner"]);
  const { email, name, role, temporaryPassword } = staffSchema.parse(input);
  const auth = deps.auth ?? getAuth();
  const created = await auth.api.signUpEmail({ body: { name, email, password: temporaryPassword } });
  const userId = created.user.id;
  try {
    await withSystemContext(
      async (tx) => {
        await tx.insert(profiles).values({ id: userId, role, fullName: name });
        await tx.insert(auditLog).values({
          actorId: actor.userId,
          actorRole: actor.role,
          action: "staff.create",
          targetType: "profile",
          targetId: userId,
          meta: { role },
        });
      },
      { url: deps.systemUrl },
    );
  } catch (err) {
    await removeAuthUser(auth, userId);
    throw err;
  }
  return { userId };
}

async function setBlocked(actor: RequestContext, target: string, blocked: boolean, deps: AuthDeps): Promise<void> {
  try {
    await withRequestContext(actor, (tx) => tx.execute(sql`select block_profile(${target}::uuid, ${blocked})`), { url: deps.appUrl });
  } catch (err) {
    const e = err as { cause?: { code?: string; message?: string } };
    if (e.cause?.code === "42501") throw new ForbiddenError(e.cause.message ?? "Not allowed");
    throw err;
  }
}

/** Owner or manager. A manager can block customers only; the database function enforces that. */
export const blockCustomer = (actor: RequestContext, profileId: string, deps: AuthDeps = {}) =>
  setBlocked(actor, profileId, true, deps);

export const unblockCustomer = (actor: RequestContext, profileId: string, deps: AuthDeps = {}) =>
  setBlocked(actor, profileId, false, deps);
