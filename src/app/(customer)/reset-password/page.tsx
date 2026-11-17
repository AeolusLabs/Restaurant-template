import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ResetPasswordForm } from "@/components/auth-forms";
import { button } from "@/components/ui";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false } };

async function Reset({ searchParams }: { searchParams: PageProps<"/reset-password">["searchParams"] }) {
  const { token, error } = await searchParams;
  if (typeof token !== "string" || !token || error) {
    return (
      <div className="space-y-4">
        <p className="rounded-lg bg-warn-soft p-4 font-semibold text-warn" role="alert">
          This link has expired or is not valid.
        </p>
        <Link href="/forgot-password" className={button.primary}>
          Get a new link
        </Link>
      </div>
    );
  }
  return <ResetPasswordForm token={token} />;
}

export default function ResetPasswordPage(props: PageProps<"/reset-password">) {
  return (
    <div className="mx-auto max-w-md space-y-6">
      <h1 className="text-2xl font-bold leading-tight">Choose a new password</h1>
      <Suspense fallback={<div className="h-48 animate-pulse rounded-xl bg-line" role="status" aria-label="Loading" />}>
        <Reset searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
