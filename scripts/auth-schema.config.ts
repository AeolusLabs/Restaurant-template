// Only used by `pnpm auth:schema` to generate src/db/schema/auth.ts. It never connects to a database.
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { baseAuthOptions } from "../src/auth/options";

export const auth = betterAuth({
  ...baseAuthOptions({ secret: "schema-generation-only-not-a-real-secret", baseURL: "http://localhost:3000" }),
  database: drizzleAdapter({} as never, { provider: "pg" }),
});
