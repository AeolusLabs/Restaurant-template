import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getIdentity } from "@/auth/customer";
import { SignUpForm } from "@/components/auth-forms";
import { safeNext } from "@/lib/safe-redirect";

export const metadata: Metadata = { title: "Create an account" };

async function SignUp({ searchParams }: { searchParams: PageProps<"/sign-up">["searchParams"] }) {
  const next = safeNext((await searchParams).next as string | undefined);
  if (await getIdentity()) redirect(next);
  return <SignUpForm next={next} />;
}

export default function SignUpPage(props: PageProps<"/sign-up">) {
  return (
    <div className="mx-auto max-w-md space-y-6">
      <div>
        <h1 className="text-2xl font-bold leading-tight">Create an account</h1>
        <p className="mt-1 text-muted">You need an account to order, so we can show you where your order is.</p>
      </div>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-line" role="status" aria-label="Loading" />}>
        <SignUp searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
