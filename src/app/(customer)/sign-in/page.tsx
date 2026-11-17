import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getIdentity } from "@/auth/customer";
import { SignInForm } from "@/components/auth-forms";
import { safeNext } from "@/lib/safe-redirect";

export const metadata: Metadata = { title: "Sign in" };

async function SignIn({ searchParams }: { searchParams: PageProps<"/sign-in">["searchParams"] }) {
  const params = await searchParams;
  const next = safeNext(params.next as string | undefined);
  if (await getIdentity()) redirect(next);
  return <SignInForm next={next} notice={params.reset ? "Your password was changed. Sign in with the new one." : undefined} />;
}

export default function SignInPage(props: PageProps<"/sign-in">) {
  return (
    <div className="mx-auto max-w-md space-y-6">
      <h1 className="text-2xl font-bold leading-tight">Sign in</h1>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-line" role="status" aria-label="Loading" />}>
        <SignIn searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
