import type { ReactNode } from "react";
import { restaurantConfig as c } from "../../config/restaurant";

/** Shared frame for the legal pages. Their text is template wording, to be reviewed by the restaurant before launch. */
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="space-y-6">
      <h1 className="text-2xl font-bold leading-tight">{title}</h1>
      {process.env.NODE_ENV !== "production" && (
        <p className="rounded-lg bg-warn-soft p-3 text-sm font-semibold text-warn" role="note">
          Template wording, shown only while developing. Have it reviewed against local law and replace it with {c.name}&apos;s own text before launch.
        </p>
      )}
      <div className="max-w-prose space-y-4 [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-bold [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6">{children}</div>
      <p className="text-sm text-muted">Version {c.legal.policyVersion}</p>
    </article>
  );
}

export const contactLine = () => [c.contact.email, c.contact.phone].filter(Boolean).join(" or ");
