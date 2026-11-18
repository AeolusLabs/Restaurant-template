import { and, eq, isNull } from "drizzle-orm";
import { raiseAlert } from "@/db/alerts";
import type { Tx } from "@/db/context";
import { alerts } from "@/db/schema";

/** Raises the low-wallet alert unless one is already open, so it is one alert, not one per failed booking. */
export async function ensureWalletAlert(tx: Tx, balanceMinor?: number): Promise<void> {
  const open = await tx.select({ id: alerts.id }).from(alerts).where(and(eq(alerts.kind, "wallet_low"), isNull(alerts.resolvedAt))).limit(1);
  if (open.length > 0) return;
  await raiseAlert(tx, { kind: "wallet_low", severity: "critical", payload: balanceMinor === undefined ? {} : { balanceMinor } });
}

/** Closes the low-wallet alert once the balance is healthy again. */
export async function resolveWalletAlert(tx: Tx): Promise<void> {
  await tx.update(alerts).set({ resolvedAt: new Date() }).where(and(eq(alerts.kind, "wallet_low"), isNull(alerts.resolvedAt)));
}
