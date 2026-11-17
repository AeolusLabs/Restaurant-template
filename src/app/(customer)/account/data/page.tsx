import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { restaurantConfig as c } from "../../../../../config/restaurant";
import { requireCustomer } from "@/auth/customer";
import { button, card } from "@/components/ui";

export const metadata: Metadata = { title: "Your data" };

async function Data() {
  await requireCustomer("/account/data");
  return (
    <div className="space-y-6">
      <section className={`${card} space-y-3 p-5`} aria-labelledby="export-h">
        <h2 id="export-h" className="text-lg font-bold">
          Download your data
        </h2>
        <p className="max-w-prose text-muted">
          Get a copy of what {c.name} holds about you: your account details, consents, orders and payments, as a file you can open in any text editor.
        </p>
        <a href="/api/me/export" download className={button.primary}>
          Download my data
        </a>
      </section>
      <section className={`${card} space-y-3 p-5`} aria-labelledby="delete-h">
        <h2 id="delete-h" className="text-lg font-bold">
          Delete your account
        </h2>
        <p className="max-w-prose text-muted">
          This removes your account, saved details and consents. We keep a record of past orders and payments, as the law requires, but without your name,
          phone number or notes. You cannot delete your account while an order is in progress.
        </p>
        <Link href="/account/delete" className={button.danger}>
          Delete my account
        </Link>
      </section>
    </div>
  );
}

export default function DataPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold leading-tight">Your data</h1>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-line" role="status" aria-label="Loading" />}>
        <Data />
      </Suspense>
    </div>
  );
}
