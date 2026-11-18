import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import { connection } from "next/server";
import { Suspense } from "react";
import { eq } from "drizzle-orm";
import { restaurantConfig as c } from "../../../../config/restaurant";
import { requireCustomer } from "@/auth/customer";
import { CheckoutForm } from "@/components/checkout-form";
import { withRequestContext } from "@/db/context";
import { profiles } from "@/db/schema";
import { describeSlot, openStatus } from "@/domain/hours";
import { pickupSlots } from "@/domain/pickup/slots";

export const metadata: Metadata = { title: "Checkout" };

async function Checkout() {
  await connection(); // slot times depend on the current time
  const { ctx } = await requireCustomer("/checkout");

  if (!c.features.pickup && !c.features.delivery) {
    return <p className="rounded-xl border border-line bg-surface p-6">Online ordering is not available right now.</p>;
  }
  const now = new Date();
  const days: { day: string; slots: { value: string; label: string }[] }[] = [];
  for (const slot of c.features.pickup ? pickupSlots(now, c) : []) {
    const [day, time] = describeSlot(slot, now, c).split(", ");
    const last = days.at(-1);
    const entry = { value: slot.toISOString(), label: time };
    if (last?.day === day) last.slots.push(entry);
    else days.push({ day, slots: [entry] });
  }
  // Delivery is for now, so it is offered only while we are open. Pickup is offered only when there are times to pick.
  const zones = c.features.delivery && openStatus(now, c).open ? c.delivery.zones : [];
  if (days.length === 0 && zones.length === 0) {
    return <p className="rounded-xl border border-line bg-surface p-6">There are no pickup or delivery times available at the moment. Please check back when we are open.</p>;
  }

  const [profile] = await withRequestContext(ctx, (tx) => tx.select({ phone: profiles.phone }).from(profiles).where(eq(profiles.id, ctx.userId)));
  return (
    <CheckoutForm
      days={days}
      zones={zones}
      promosEnabled={c.features.promos}
      defaultPhone={profile?.phone ?? ""}
      // One token per page load: a double tap on Pay returns the same order instead of making two.
      checkoutToken={randomUUID().replaceAll("-", "")}
      address={[c.address.line1, c.address.area, c.address.city].filter(Boolean).join(", ")}
    />
  );
}

export default function CheckoutPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold leading-tight">Checkout</h1>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-line" role="status" aria-label="Loading checkout" />}>
        <Checkout />
      </Suspense>
    </div>
  );
}
