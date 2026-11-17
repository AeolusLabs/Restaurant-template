"use client";

import Link from "next/link";
import { button } from "@/components/ui";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="mx-auto w-full max-w-3xl flex-1 space-y-4 px-4 py-12" role="alert">
      <h1 className="text-2xl font-bold leading-tight">Something went wrong</h1>
      <p className="text-muted">We could not load this page. Your cart is safe. Try again, or go back to the menu.</p>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={reset} className={button.primary}>
          Try again
        </button>
        <Link href="/" className={button.secondary}>
          Back to the menu
        </Link>
      </div>
    </main>
  );
}
