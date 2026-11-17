import { sql } from "drizzle-orm";
import { z } from "zod";
import { getAuth } from "@/auth/auth";
import { removeAuthUser } from "@/auth/signup";
import type { AuthDeps } from "@/auth/session";
import { withSystemContext } from "@/db/context";
import { auditLog, profiles } from "@/db/schema";

const schema = z.object({
  email: z.email(),
  password: z.string().min(8, "INITIAL_OWNER_PASSWORD must be at least 8 characters").max(128),
});

/**
 * Creates the first owner from INITIAL_OWNER_EMAIL and INITIAL_OWNER_PASSWORD. Does nothing unless both
 * are set, or when a user with that email already exists. Remove the two variables after the first boot.
 */
export async function seedOwnerFromEnv(
  env: Record<string, string | undefined>,
  deps: AuthDeps = {},
): Promise<{ created: boolean }> {
  const email = env.INITIAL_OWNER_EMAIL;
  const password = env.INITIAL_OWNER_PASSWORD;
  if (!email || !password) return { created: false };
  const parsed = schema.parse({ email, password });

  const exists = await withSystemContext(
    (tx) => tx.execute(sql`select 1 from "user" where lower(email) = lower(${parsed.email})`),
    { url: deps.systemUrl },
  );
  if (exists.rows.length) return { created: false };

  const auth = deps.auth ?? getAuth();
  const created = await auth.api.signUpEmail({ body: { name: "Owner", email: parsed.email, password: parsed.password } });
  try {
    await withSystemContext(
      async (tx) => {
        await tx.insert(profiles).values({ id: created.user.id, role: "owner", fullName: "Owner" });
        await tx.insert(auditLog).values({
          actorRole: "system",
          action: "owner.seed",
          targetType: "profile",
          targetId: created.user.id,
        });
      },
      { url: deps.systemUrl },
    );
  } catch (err) {
    await removeAuthUser(auth, created.user.id);
    throw err;
  }
  return { created: true };
}
