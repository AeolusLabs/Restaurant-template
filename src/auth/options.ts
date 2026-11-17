import type { BetterAuthOptions } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";

export type AuthConfig = { secret: string; baseURL: string };

/** Everything except the database, so the schema generator can load it without a connection. */
export function baseAuthOptions(cfg: AuthConfig) {
  return {
    secret: cfg.secret,
    baseURL: cfg.baseURL,
    emailAndPassword: { enabled: true },
    // UUID ids on every table, matching the rest of the schema.
    advanced: { database: { generateId: "uuid" } },
    // Lets server actions set the session cookie. Must stay the last plugin.
    plugins: [nextCookies()],
    hooks: {
      // Customers sign up only through signUpCustomer(), which records consent and creates the
      // profile. A request that arrives over HTTP (it has a Request) is refused. Server-side calls
      // to auth.api have none, so signUpCustomer and createStaffUser still work.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-up/email" && ctx.request) {
          throw new APIError("FORBIDDEN", { message: "Sign up through the application." });
        }
      }),
    },
  } satisfies Omit<BetterAuthOptions, "database">;
}
