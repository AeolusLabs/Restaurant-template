import Link from "next/link";
import { button } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="space-y-4 py-8">
      <h1 className="text-2xl font-bold leading-tight">We could not find that page</h1>
      <p className="text-muted">It may have moved, or the link may be wrong.</p>
      <Link href="/" className={button.primary}>
        Back to the menu
      </Link>
    </div>
  );
}
