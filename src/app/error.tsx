"use client";

import Link from "next/link";
import { button } from "@/components/ui";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="space-y-4 py-8" role="alert">
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
    </div>
  );
}
