import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { requireStaff } from "@/auth/customer";
import { Notice } from "@/components/staff/notice";
import { button } from "@/components/ui";
import type { PromoFormValues } from "@/domain/promos/form";
import { valuesFrom } from "@/lib/notice-url";
import { createPromoAction } from "../actions";
import { PromoForm } from "../promo-form";

export const metadata: Metadata = { title: "New promo" };

const BLANK: PromoFormValues = {
  code: "",
  description: "",
  kind: "percent",
  percent: "",
  amount: "",
  minOrder: "",
  maxDiscount: "",
  startsAt: "",
  expiresAt: "",
  maxRedemptions: "",
  maxPerCustomer: "1",
  active: "on",
};

async function NewPromo({ searchParams }: { searchParams: PageProps<"/admin/promos/new">["searchParams"] }) {
  const params = await searchParams;
  await requireStaff(["owner", "manager"], "/admin/promos/new");
  const typed = valuesFrom(params);
  // After a refusal the form comes back as typed; an unchecked box is simply absent from what was sent.
  const values = Object.keys(typed).length > 0 ? ({ ...BLANK, ...typed, active: typed.active ?? "" } as PromoFormValues) : BLANK;
  return (
    <div className="space-y-4">
      <Notice error={params.error} />
      <PromoForm action={createPromoAction} values={values} submit="Create promo" />
      <Link href="/admin/promos" className={button.quiet}>
        All promos
      </Link>
    </div>
  );
}

export default function NewPromoPage(props: PageProps<"/admin/promos/new">) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold leading-tight">New promo</h1>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-line" role="status" aria-label="Loading" />}>
        <NewPromo searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
