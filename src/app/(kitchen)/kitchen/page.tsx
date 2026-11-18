import { Suspense } from "react";
import { restaurantConfig as c } from "../../../../config/restaurant";
import { requireStaff } from "@/auth/customer";
import { KitchenBoard } from "@/components/staff/kitchen-board";
import { listOrdersForStaff } from "@/db/staff-orders";
import { toStaffOrder } from "@/lib/sanitize";

async function Board() {
  const { ctx } = await requireStaff(["owner", "manager", "kitchen"], "/kitchen");
  const rows = await listOrdersForStaff(ctx, { statuses: ["paid", "accepted", "preparing", "ready"], limit: 200 });
  return (
    <KitchenBoard
      initial={rows.map((r) => toStaffOrder(r.order, r.items, r.phone))}
      role={ctx.role as "kitchen" | "manager" | "owner"}
      timezone={c.timezone}
      locale={c.locale}
    />
  );
}

export default function KitchenPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold leading-tight">Kitchen</h1>
      <Suspense fallback={<div className="h-48 animate-pulse rounded-xl bg-line" role="status" aria-label="Loading orders" />}>
        <Board />
      </Suspense>
    </div>
  );
}
