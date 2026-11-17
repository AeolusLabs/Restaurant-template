import Link from "next/link";
import { restaurantConfig as c } from "../../config/restaurant";

const link = "inline-flex min-h-11 items-center underline underline-offset-4 hover:text-ink";

export function Footer() {
  const address = [c.address.line1, c.address.area, c.address.city].filter(Boolean).join(", ");
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto grid max-w-3xl gap-6 px-4 py-8 text-sm text-muted sm:grid-cols-2">
        <div>
          <p className="text-base font-semibold text-ink">{c.name}</p>
          <p>{address}</p>
          {c.contact.phone && <p>{c.contact.phone}</p>}
          {c.contact.email && <p>{c.contact.email}</p>}
        </div>
        <nav aria-label="Legal and privacy" className="flex flex-col sm:items-end">
          <Link href="/legal/terms" className={link}>
            Terms of use
          </Link>
          <Link href="/legal/privacy" className={link}>
            Privacy policy
          </Link>
          <Link href="/account/data" className={link}>
            Your data
          </Link>
        </nav>
      </div>
    </footer>
  );
}
