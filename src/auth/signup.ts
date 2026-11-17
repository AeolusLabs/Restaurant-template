import { z } from "zod";
import { restaurantConfig } from "../../config/restaurant";
import { withSystemContext } from "@/db/context";
import { consents, profiles } from "@/db/schema";
import { getAuth, type Auth } from "./auth";
import type { AuthDeps } from "./session";

export class ConsentRequiredError extends Error {}

const schema = z.object({
  email: z.email(),
  password: z.string().min(8).max(128),
  name: z.string().trim().min(1).max(200),
  consent: z.object({ terms: z.boolean(), privacy: z.boolean(), marketing: z.boolean().optional() }),
});
export type SignUpInput = z.input<typeof schema>;

/** Undoes a Better Auth user when the step that follows its creation fails. Best effort. */
export async function removeAuthUser(auth: Auth, userId: string): Promise<void> {
  try {
    await (await auth.$context).internalAdapter.deleteUser(userId);
  } catch {
    // The original error is the one worth reporting.
  }
}

/**
 * The only way a customer account is created. Better Auth cannot join our transaction, so the user is
 * created first and removed again if the profile or consent rows cannot be written. Unknown fields in
 * the input (such as a role) are dropped by the schema, and the profile is always a customer.
 */
export async function signUpCustomer(input: SignUpInput, deps: AuthDeps = {}): Promise<{ userId: string }> {
  const { email, password, name, consent } = schema.parse(input);
  if (!consent.terms || !consent.privacy) {
    throw new ConsentRequiredError("Accepting the terms and the privacy policy is required to create an account");
  }
  const auth = deps.auth ?? getAuth();
  const created = await auth.api.signUpEmail({ body: { name, email, password } });
  const userId = created.user.id;
  const version = restaurantConfig.legal.policyVersion;
  const types = [
    "terms" as const,
    "privacy" as const,
    ...(consent.marketing ? (["marketing"] as const) : []),
  ];
  try {
    await withSystemContext(
      async (tx) => {
        await tx.insert(profiles).values({ id: userId, role: "customer", fullName: name });
        await tx.insert(consents).values(types.map((type) => ({ profileId: userId, type, policyVersion: version })));
      },
      { url: deps.systemUrl },
    );
  } catch (err) {
    await removeAuthUser(auth, userId);
    throw err;
  }
  return { userId };
}
