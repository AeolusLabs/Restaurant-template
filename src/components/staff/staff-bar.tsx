import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { restaurantConfig } from "../../../config/restaurant";
import { signOutAction } from "@/auth/actions";
import { getIdentity } from "@/auth/customer";
import type { AppRole } from "@/domain/roles";

const link = "inline-flex min-h-11 items-center rounded-lg px-3 text-base font-semibold text-ink hover:bg-brand-soft";

type NavLink = { href: string; label: string; roles: readonly AppRole[] };
const ADMIN_LINKS: readonly NavLink[] = [
  { href: "/admin", label: "Home", roles: ["owner", "manager"] },
  { href: "/admin/orders", label: "Orders", roles: ["owner", "manager"] },
  { href: "/admin/menu", label: "Menu", roles: ["owner", "manager"] },
  { href: "/admin/staff", label: "Staff", roles: ["owner", "manager"] },
  { href: "/kitchen", label: "Kitchen screen", roles: ["owner", "manager", "kitchen"] },
];

async function WhoAmI() {
  const id = await getIdentity();
  if (!id) return null;
  return (
    <div className="flex items-center gap-2 text-sm text-muted">
      <span>
        {id.name} <span className="capitalize">({id.ctx.role})</span>
      </span>
      <form action={signOutAction}>
        <button type="submit" className="min-h-11 rounded-lg px-3 font-semibold text-brand underline underline-offset-4">
          Sign out
        </button>
      </form>
    </div>
  );
}

async function AdminLinks() {
  const id = await getIdentity();
  const role = id?.ctx.role;
  return (
    <nav aria-label="Admin" className="-ml-3 flex basis-full flex-wrap items-center gap-1">
      {ADMIN_LINKS.filter((l) => role && l.roles.includes(role)).map((l) => (
        <Link key={l.href} href={l.href} className={link}>
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

/** The bar at the top of every staff screen: where you are, who you are, and (for admin) where to go. */
export function StaffBar({ area, withNav }: { area: string; withNav: boolean }) {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
        <Link href={withNav ? "/admin" : "/kitchen"} className="min-h-11 py-2 text-lg font-bold leading-tight text-ink">
          {restaurantConfig.name} <span className="font-normal text-muted">{area}</span>
        </Link>
        <Suspense fallback={null}>
          <WhoAmI />
        </Suspense>
        {withNav && (
          <Suspense fallback={null}>
            <AdminLinks />
          </Suspense>
        )}
      </div>
    </header>
  );
}

export function StaffMain({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <main id="main" className={`mx-auto w-full flex-1 px-4 py-6 ${wide ? "max-w-7xl" : "max-w-5xl"}`}>
      {children}
    </main>
  );
}
