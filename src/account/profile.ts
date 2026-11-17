import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { restaurantConfig } from "../../config/restaurant";
import { withRequestContext, type RequestContext } from "@/db/context";
import { consents, profiles } from "@/db/schema";
import { phoneSchema } from "@/domain/checkout/order-input";

type Opts = { appUrl?: string };

const nameSchema = z.string().trim().min(1, "Enter your name").max(200);

/** Changes the caller's own name and phone. An empty phone clears it. The database allows nothing else. */
export async function updateProfile(
  ctx: RequestContext,
  input: { fullName: string; phone?: string | null },
  opts: Opts = {},
): Promise<void> {
  const fullName = nameSchema.parse(input.fullName);
  const raw = input.phone?.trim();
  const phone = raw ? phoneSchema.parse(raw) : null;
  await withRequestContext(ctx, (tx) => tx.update(profiles).set({ fullName, phone }).where(eq(profiles.id, ctx.userId)), { url: opts.appUrl });
}

/**
 * Grants or withdraws marketing consent. Terms and privacy are not optional, so they cannot be withdrawn
 * here (leaving means deleting the account). Granting again after a withdrawal adds a new row, so the
 * history of consent is kept.
 */
export async function setMarketingConsent(
  ctx: RequestContext,
  granted: boolean,
  opts: Opts & { policyVersion?: string } = {},
): Promise<void> {
  await withRequestContext(
    ctx,
    async (tx) => {
      const open = and(eq(consents.profileId, ctx.userId), eq(consents.type, "marketing"), isNull(consents.withdrawnAt));
      if (granted) {
        const [existing] = await tx.select({ id: consents.id }).from(consents).where(open).limit(1);
        if (!existing) {
          await tx.insert(consents).values({
            profileId: ctx.userId,
            type: "marketing",
            policyVersion: opts.policyVersion ?? restaurantConfig.legal.policyVersion,
          });
        }
      } else {
        await tx.update(consents).set({ withdrawnAt: new Date() }).where(open);
      }
    },
    { url: opts.appUrl },
  );
}
