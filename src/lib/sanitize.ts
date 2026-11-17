import { APP_ROLES, type AppRole } from "@/domain/roles";

// The single definition of "safe to return" for a person. Never hand-roll another destructure:
// route every user or profile row through toPublicUser() before it reaches a response.
// This is a whitelist, so a column added to a table later is private until it is listed here.

export type PublicUser = { id: string; name: string; email: string; role: AppRole };

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

export function toPublicUser(row: unknown): PublicUser {
  if (typeof row !== "object" || row === null) throw new TypeError("toPublicUser expects an object");
  const r = row as Record<string, unknown>;
  const id = str(r.id);
  if (!id) throw new TypeError("toPublicUser: row has no id");
  const role = r.role;
  if (typeof role !== "string" || !(APP_ROLES as readonly string[]).includes(role)) {
    throw new TypeError("toPublicUser: row has no valid role (merge the profile into the row first)");
  }
  return {
    id,
    name: str(r.name) ?? str(r.fullName) ?? str(r.full_name) ?? "",
    email: str(r.email) ?? "",
    role: role as AppRole,
  };
}
