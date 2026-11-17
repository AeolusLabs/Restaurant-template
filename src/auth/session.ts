import { sql } from "drizzle-orm";
import { withSystemContext, type RequestContext } from "@/db/context";
import type { AppRole } from "@/domain/roles";
import { getAuth, type Auth } from "./auth";

export class UnauthenticatedError extends Error {}
export class ForbiddenError extends Error {}

/** Injection points for tests and scripts. Production code passes nothing and uses the environment. */
export type AuthDeps = { auth?: Auth; systemUrl?: string; appUrl?: string };

/**
 * Turns a request's session cookie into the identity RLS runs on. Returns null for no session,
 * a user with no profile, a blocked profile, or a deleted one. The role always comes from the
 * profile row, never from the session.
 */
export async function getRequestContext(headers: Headers, deps: AuthDeps = {}): Promise<RequestContext | null> {
  return (await getRequestIdentity(headers, deps))?.ctx ?? null;
}

export type RequestIdentity = { ctx: RequestContext; email: string; name: string };

/** getRequestContext plus the account's email and name, for pages that show them or hand them to a provider. */
export async function getRequestIdentity(headers: Headers, deps: AuthDeps = {}): Promise<RequestIdentity | null> {
  const session = await (deps.auth ?? getAuth()).api.getSession({ headers });
  if (!session) return null;
  const { rows } = await withSystemContext(
    (tx) => tx.execute(sql`select role, blocked_at, deleted_at from profiles where id = ${session.user.id}::uuid`),
    { url: deps.systemUrl },
  );
  const profile = rows[0];
  if (!profile || profile.blocked_at || profile.deleted_at) return null;
  return {
    ctx: { userId: session.user.id, role: profile.role as AppRole },
    email: session.user.email,
    name: session.user.name,
  };
}

export function requireRole(ctx: RequestContext | null, allowed: readonly AppRole[]): RequestContext {
  if (!ctx) throw new UnauthenticatedError("Sign in required");
  if (!allowed.includes(ctx.role)) throw new ForbiddenError(`Requires one of: ${allowed.join(", ")}`);
  return ctx;
}
