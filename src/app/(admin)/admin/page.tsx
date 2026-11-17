import { Suspense } from "react";
import { requireStaff } from "@/auth/customer";

async function Home() {
  const { name } = await requireStaff(["owner", "manager"], "/admin");
  return <p className="text-muted">Signed in as {name}.</p>;
}

export default function AdminHome() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold leading-tight">Home</h1>
      <Suspense fallback={<div className="h-24 animate-pulse rounded-xl bg-line" role="status" aria-label="Loading" />}>
        <Home />
      </Suspense>
    </div>
  );
}
