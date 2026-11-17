import { headers } from "next/headers";
import { redirect } from "next/navigation";
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
