import { and, eq, isNull } from "drizzle-orm";
import { restaurantConfig } from "../../config/restaurant";
import type { RestaurantConfig } from "../../config/schema";
import { raiseAlert } from "@/db/alerts";
import { withSystemContext, type Tx } from "@/db/context";
import { alerts, walletSnapshots } from "@/db/schema";
import { providers } from "@/providers";
import type { DeliveryProvider } from "@/providers/delivery/types";

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

export type WalletCheck = { checked: false } | { checked: true; balanceMinor: number; low: boolean };

/**
 * Asks the delivery provider for the prepaid wallet balance, records it, and raises or closes the low-wallet alert
 * (a balance below `delivery.lowWalletMinor` is low). An unreachable provider changes nothing: not knowing the
 * balance is not the same as the balance being low, and booking failures raise the alert on their own.
 */
export async function checkWallet(deps: { provider?: DeliveryProvider; systemUrl?: string; config?: RestaurantConfig } = {}): Promise<WalletCheck> {
  const cfg = deps.config ?? restaurantConfig;
  if (!cfg.features.delivery) return { checked: false };
  let balanceMinor: number;
  try {
    ({ balanceMinor } = await (deps.provider ?? providers().delivery).getWalletBalance());
  } catch (err) {
    console.error("could not read the delivery wallet balance:", err instanceof Error ? err.message : err);
    return { checked: false };
  }
  const low = balanceMinor < cfg.delivery.lowWalletMinor;
  await withSystemContext(
    async (tx) => {
      await tx.insert(walletSnapshots).values({ balanceMinor });
      await (low ? ensureWalletAlert(tx, balanceMinor) : resolveWalletAlert(tx));
    },
    { url: deps.systemUrl },
  );
  return { checked: true, balanceMinor, low };
}
