import type { Metadata } from "next";
import Link from "next/link";
import { and, eq, isNull } from "drizzle-orm";
import { Suspense } from "react";
import { requireCustomer } from "@/auth/customer";
import { ProfileForm } from "@/components/account-forms";
import { button, card } from "@/components/ui";
import { withRequestContext } from "@/db/context";
import { consents, profiles } from "@/db/schema";
import { signOutAction } from "@/auth/actions";
import { setMarketingAction } from "./actions";

export const metadata: Metadata = { title: "Your account" };

async function Account() {
  const { ctx, email } = await requireCustomer("/account");
  const { profile, marketing } = await withRequestContext(ctx, async (tx) => ({
    profile: (await tx.select({ fullName: profiles.fullName, phone: profiles.phone }).from(profiles).where(eq(profiles.id, ctx.userId)))[0],
    marketing: (await tx.select({ id: consents.id }).from(consents).where(and(eq(consents.profileId, ctx.userId), eq(consents.type, "marketing"), isNull(consents.withdrawnAt))).limit(1)).length > 0,
  }));

  return (
    <div className="space-y-8">
      <section className={`${card} space-y-4 p-5`} aria-labelledby="details-h">
        <h2 id="details-h" className="text-lg font-bold">
          Your details
        </h2>
        <p className="text-muted">Signed in as {email}</p>
        <ProfileForm fullName={profile?.fullName ?? ""} phone={profile?.phone ?? ""} />
      </section>

      <section className={`${card} space-y-3 p-5`} aria-labelledby="marketing-h">
        <h2 id="marketing-h" className="text-lg font-bold">
          News and offers
        </h2>
        <form action={setMarketingAction} className="space-y-3">
          <label className="flex min-h-11 items-start gap-3">
            <input type="checkbox" name="marketing" defaultChecked={marketing} className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--brand)]" />
            <span>Send me news and offers from the restaurant.</span>
          </label>
          <button type="submit" className={button.secondary}>
            Save preference
          </button>
        </form>
      </section>

      <section className="flex flex-wrap items-center gap-3" aria-label="More">
        <Link href="/orders" className={button.secondary}>
          My orders
        </Link>
        <Link href="/account/data" className={button.secondary}>
          Your data
        </Link>
        <form action={signOutAction}>
          <button type="submit" className={button.quiet}>
            Sign out
          </button>
        </form>
      </section>
    </div>
  );
}

export default function AccountPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold leading-tight">Your account</h1>
      <Suspense fallback={<div className="h-72 animate-pulse rounded-xl bg-line" role="status" aria-label="Loading your account" />}>
        <Account />
      </Suspense>
    </div>
  );
}
