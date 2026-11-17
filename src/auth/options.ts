import type { BetterAuthOptions } from "better-auth";

export type AuthConfig = { secret: string; baseURL: string };

/** Everything except the database, so the schema generator can load it without a connection. */
export function baseAuthOptions(cfg: AuthConfig) {
  return {
    secret: cfg.secret,
    baseURL: cfg.baseURL,
    emailAndPassword: { enabled: true },
    // UUID ids on every table, matching the rest of the schema.
    advanced: { database: { generateId: "uuid" } },
  } satisfies Omit<BetterAuthOptions, "database">;
}
