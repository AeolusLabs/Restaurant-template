import { Suspense } from "react";
import { requireStaff } from "@/auth/customer";

async function Board() {
  await requireStaff(["owner", "manager", "kitchen"], "/kitchen");
  return <p className="text-muted">The kitchen display arrives in the next task.</p>;
}

export default function KitchenPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold leading-tight">Kitchen</h1>
      <Suspense fallback={<div className="h-24 animate-pulse rounded-xl bg-line" role="status" aria-label="Loading" />}>
        <Board />
      </Suspense>
    </div>
  );
}
