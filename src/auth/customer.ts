import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { AppRole } from "@/domain/roles";
import { staffGate } from "@/domain/staff-gate";
import { getRequestIdentity, type RequestIdentity } from "./session";

// Helpers for server components and actions. Reading the session reads request headers, so under Cache
// Components every caller must sit behind <Suspense> (or be a server action or route handler).

/** The signed-in person (any role), or null. Blocked and deleted accounts read as signed out. */
export async function getIdentity(): Promise<RequestIdentity | null> {
  return getRequestIdentity(await headers());
}

/** A signed-in customer, or a redirect to sign in that returns here afterwards. */
export async function requireCustomer(returnTo: string): Promise<RequestIdentity> {
  const id = await getIdentity();
  if (!id) redirect(`/sign-in?next=${encodeURIComponent(returnTo)}`);
  // Staff have their own screens (Phase 3). The customer site is for customers.
  if (id.ctx.role !== "customer") redirect("/");
  return id;
}

/**
 * A signed-in staff member whose role is on the list, or a redirect: to sign in (and back here afterwards),
 * or to the person's own home. The database enforces the same rules; this just sends people somewhere useful.
 */
export async function requireStaff(allowed: readonly AppRole[], here: string): Promise<RequestIdentity> {
  const id = await getIdentity();
  const gate = staffGate(id?.ctx.role ?? null, allowed, here);
  if (!gate.ok) redirect(gate.redirect);
  return id!;
}
