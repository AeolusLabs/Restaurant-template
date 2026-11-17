import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireCustomer } from "@/auth/customer";
import { DeleteAccountForm } from "@/components/account-forms";
import { button, card } from "@/components/ui";

export const metadata: Metadata = { title: "Delete your account" };

async function Delete() {
  await requireCustomer("/account/delete");
  return (
    <div className={`${card} space-y-5 p-5`}>
      <p className="max-w-prose">
        Your account, saved details and consents will be removed. Past orders stay on record without your name, phone number or notes. This cannot be
        undone.
      </p>
      <DeleteAccountForm />
      <Link href="/account/data" className={button.quiet}>
        Keep my account
      </Link>
    </div>
  );
}

export default function DeletePage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold leading-tight">Delete your account</h1>
      <Suspense fallback={<div className="h-48 animate-pulse rounded-xl bg-line" role="status" aria-label="Loading" />}>
        <Delete />
      </Suspense>
    </div>
  );
}
