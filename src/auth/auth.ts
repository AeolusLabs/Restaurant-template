import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { drizzle } from "drizzle-orm/node-postgres";
import { getPool } from "@/db/context";
import * as authSchema from "@/db/schema/auth";
import { restaurantConfig } from "../../config/restaurant";
import { providers } from "@/providers";
import type { EmailProvider } from "@/providers/email/types";
import { baseAuthOptions, type AuthConfig } from "./options";
import { buildResetEmail } from "./reset-email";

export type CreateAuthConfig = Omit<AuthConfig, "sendResetPassword"> & { databaseUrl: string; email?: EmailProvider; appName?: string };

/** Better Auth runs as the `system` database role: it works before anyone is signed in. */
export function createAuth(cfg: CreateAuthConfig) {
  const db = drizzle(getPool(cfg.databaseUrl));
  const { email, appName = restaurantConfig.name } = cfg;
  return betterAuth({
    ...baseAuthOptions({
      ...cfg,
      sendResetPassword: email
        ? async ({ user, url }) => {
            await email.send({ to: user.email, ...buildResetEmail({ name: user.name, url, appName }) });
          }
        : undefined,
    }),
    database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
  });
}

export type Auth = ReturnType<typeof createAuth>;

let instance: Auth | undefined;

/** Built on first use from the environment, so importing this module never needs a database. */
export function getAuth(): Auth {
  if (!instance) {
    const need = (k: string): string => {
      const v = process.env[k];
      if (!v) throw new Error(`${k} is not set`);
      return v;
    };
    instance = createAuth({
      databaseUrl: need("DATABASE_SYSTEM_URL"),
      secret: need("BETTER_AUTH_SECRET"),
      baseURL: need("APP_URL"),
      email: providers().email,
    });
  }
  return instance;
}
