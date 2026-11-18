import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { restaurantConfig as c } from "../../../../../../config/restaurant";
import { requireStaff } from "@/auth/customer";
import { Notice } from "@/components/staff/notice";
import { button } from "@/components/ui";
import { getPromo } from "@/db/promos-admin";
import { promoToForm, type PromoFormValues } from "@/domain/promos/form";
import { money } from "@/lib/format";
import { valuesFrom } from "@/lib/notice-url";
import { updatePromoAction } from "../actions";
import { PromoForm } from "../promo-form";

export const metadata: Metadata = { title: "Edit promo" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function EditPromo({ params, searchParams }: { params: PageProps<"/admin/promos/[id]">["params"]; searchParams: PageProps<"/admin/promos/[id]">["searchParams"] }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const query = await searchParams;
  const { ctx } = await requireStaff(["owner", "manager"], `/admin/promos/${id}`);
  const promo = await getPromo(ctx, id);
  if (!promo) notFound();
  const typed = valuesFrom(query);
  const saved = promoToForm(promo, { exponent: c.currency.exponent, timeZone: c.timezone });
  const values = Object.keys(typed).length > 0 ? ({ ...saved, ...typed, active: typed.active ?? "" } as PromoFormValues) : saved;
  return (
    <div className="space-y-4">
      <Notice error={query.error} />
      <p className="text-muted">
        Used {promo.redemptions} {promo.redemptions === 1 ? "time" : "times"}, taking {money(promo.discountGivenMinor)} off in total. Orders already placed keep the discount they were given, whatever you change here.
      </p>
      <PromoForm action={updatePromoAction} values={values} id={id} submit="Save changes" />
      <Link href="/admin/promos" className={button.quiet}>
        All promos
      </Link>
    </div>
  );
}

export default function EditPromoPage(props: PageProps<"/admin/promos/[id]">) {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold leading-tight">Edit promo</h1>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-line" role="status" aria-label="Loading" />}>
        <EditPromo params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}
