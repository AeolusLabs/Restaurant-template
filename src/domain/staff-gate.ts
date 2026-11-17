import type { AppRole } from "./roles";

// Who may open which screen, and where each person goes instead. Pure, so the redirect rules (including
// that nobody is sent in a circle) are tested. The database is still the real control: row-level security
// refuses staff data to anyone else even if a screen were reached.

export function landingPath(role: AppRole): string {
  if (role === "owner" || role === "manager") return "/admin";
  if (role === "kitchen") return "/kitchen";
  return "/";
}

/** Where to go after signing in: the page asked for, or the person's own home when none was. */
export function postSignInPath(role: AppRole, next: string): string {
  return next === "/" ? landingPath(role) : next;
}

export type GateResult = { ok: true } | { ok: false; redirect: string };

export function staffGate(role: AppRole | null, allowed: readonly AppRole[], here: string): GateResult {
  if (role === null) return { ok: false, redirect: `/sign-in?next=${encodeURIComponent(here)}` };
  if (allowed.includes(role)) return { ok: true };
  const home = landingPath(role);
  // Sending someone to the screen they were just refused on would loop forever.
  return { ok: false, redirect: here === home ? "/" : home };
}
