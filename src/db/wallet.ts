import { desc } from "drizzle-orm";
import { withRequestContext, type ContextOptions, type RequestContext } from "./context";
import { walletSnapshots } from "./schema";

/** The delivery wallet balance as last checked. Owners and managers only (row-level security), null when never checked. */
export function latestWalletSnapshot(ctx: RequestContext, opts?: ContextOptions): Promise<{ balanceMinor: number; checkedAt: Date } | null> {
  return withRequestContext(
    ctx,
    async (tx) => {
      const [row] = await tx.select({ balanceMinor: walletSnapshots.balanceMinor, checkedAt: walletSnapshots.checkedAt }).from(walletSnapshots).orderBy(desc(walletSnapshots.checkedAt)).limit(1);
      return row ?? null;
    },
    opts,
  );
}
