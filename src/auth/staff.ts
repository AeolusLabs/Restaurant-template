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

const STAFF_ROLES = ["owner", "manager", "kitchen"] as const;
const staffRoleSchema = z.enum(STAFF_ROLES);

export type StaffMember = { id: string; name: string; email: string; role: (typeof STAFF_ROLES)[number]; blocked: boolean; createdAt: Date };

/** Owner or manager. Staff only (never customers), with the email to show, and nothing secret. */
export async function listStaff(actor: RequestContext, deps: AuthDeps = {}): Promise<StaffMember[]> {
  requireRole(actor, ["owner", "manager"]);
  const { rows } = await withSystemContext(
    (tx) =>
      tx.execute(sql`
        select p.id, p.full_name, u.email, p.role, p.blocked_at, p.created_at
        from profiles p join "user" u on u.id = p.id
        where p.role in ('owner', 'manager', 'kitchen') and p.deleted_at is null
        order by case p.role when 'owner' then 0 when 'manager' then 1 else 2 end, p.full_name`),
    { url: deps.systemUrl },
  );
  return rows.map((r) => ({
    id: r.id as string,
    name: r.full_name as string,
    email: r.email as string,
    role: r.role as StaffMember["role"],
    blocked: r.blocked_at !== null,
    createdAt: new Date(r.created_at as string),
  }));
}

async function staffTarget(targetId: string, deps: AuthDeps): Promise<{ email: string; role: string } | undefined> {
  const { rows } = await withSystemContext(
    (tx) => tx.execute(sql`select u.email, p.role from profiles p join "user" u on u.id = p.id where p.id = ${targetId}::uuid and p.deleted_at is null`),
    { url: deps.systemUrl },
  );
  return rows[0] as { email: string; role: string } | undefined;
}

/** Owner only, on staff only. The database refuses an owner changing their own role. */
export async function changeStaffRole(actor: RequestContext, targetId: string, role: (typeof STAFF_ROLES)[number], deps: AuthDeps = {}): Promise<void> {
  requireRole(actor, ["owner"]);
  const newRole = staffRoleSchema.parse(role);
  const target = await staffTarget(targetId, deps);
  if (!target || !(STAFF_ROLES as readonly string[]).includes(target.role)) throw new ForbiddenError("That account is not a staff member");
  try {
    await withRequestContext(actor, (tx) => tx.execute(sql`select set_profile_role(${targetId}::uuid, ${newRole}::app_role)`), { url: deps.appUrl });
  } catch (err) {
    const e = err as { cause?: { code?: string; message?: string } };
    if (e.cause?.code === "42501") throw new ForbiddenError(e.cause.message ?? "Not allowed");
    throw err;
  }
}

/** Owner only (the database function lets a manager block customers only), and never yourself. */
export const blockStaff = (actor: RequestContext, targetId: string, deps: AuthDeps = {}) => setBlocked(actor, targetId, true, deps);
export const unblockStaff = (actor: RequestContext, targetId: string, deps: AuthDeps = {}) => setBlocked(actor, targetId, false, deps);

/** Owner only. Emails a staff member a link to choose a new password. */
export async function sendStaffPasswordReset(actor: RequestContext, targetId: string, deps: AuthDeps = {}): Promise<void> {
  requireRole(actor, ["owner"]);
  const target = await staffTarget(targetId, deps);
  if (!target || !(STAFF_ROLES as readonly string[]).includes(target.role)) throw new ForbiddenError("That account is not a staff member");
  await (deps.auth ?? getAuth()).api.requestPasswordReset({ body: { email: target.email, redirectTo: "/reset-password" } });
  await withSystemContext(
    (tx) =>
      tx.insert(auditLog).values({ actorId: actor.userId, actorRole: actor.role, action: "staff.password_reset_sent", targetType: "profile", targetId }),
    { url: deps.systemUrl },
  );
}
