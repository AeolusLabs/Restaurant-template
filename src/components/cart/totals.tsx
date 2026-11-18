"use client";

import { useMoney } from "@/components/money-context";

type Props = {
  subtotalMinor: number;
  serviceChargeMinor: number;
  taxMinor: number;
  /** Shown as its own line when there is one. */
  deliveryFeeMinor?: number;
  totalMinor: number;
  charges: { serviceChargeBps: number; taxBps: number; pricesIncludeCharges: boolean };
};

const pct = (bps: number) => `${(bps / 100).toLocaleString("en", { maximumFractionDigits: 2 })}%`;

/** Every amount the customer will pay, before they pay it. */
export function OrderTotals({ subtotalMinor, serviceChargeMinor, taxMinor, deliveryFeeMinor = 0, totalMinor, charges }: Props) {
  const money = useMoney();
  const row = "flex items-baseline justify-between gap-4";
  return (
    <dl className="space-y-1 text-base">
      {charges.pricesIncludeCharges ? (
        <>
          <div className={row}>
            <dt>Items</dt>
            <dd>{money(subtotalMinor)}</dd>
          </div>
          {serviceChargeMinor > 0 && (
            <div className={`${row} text-sm text-muted`}>
              <dt>Includes service charge ({pct(charges.serviceChargeBps)})</dt>
              <dd>{money(serviceChargeMinor)}</dd>
            </div>
          )}
          {taxMinor > 0 && (
            <div className={`${row} text-sm text-muted`}>
              <dt>Includes tax ({pct(charges.taxBps)})</dt>
              <dd>{money(taxMinor)}</dd>
            </div>
          )}
        </>
      ) : (
        <>
          <div className={row}>
            <dt>Items</dt>
            <dd>{money(subtotalMinor)}</dd>
          </div>
          {serviceChargeMinor > 0 && (
            <div className={row}>
              <dt>Service charge ({pct(charges.serviceChargeBps)})</dt>
              <dd>{money(serviceChargeMinor)}</dd>
            </div>
          )}
          {taxMinor > 0 && (
            <div className={row}>
              <dt>Tax ({pct(charges.taxBps)})</dt>
              <dd>{money(taxMinor)}</dd>
            </div>
          )}
        </>
      )}
      {deliveryFeeMinor > 0 && (
        <div className={row}>
          <dt>Delivery</dt>
          <dd>{money(deliveryFeeMinor)}</dd>
        </div>
      )}
      <div className={`${row} border-t border-line pt-2 text-lg font-semibold`}>
        <dt>Total</dt>
        <dd>{money(totalMinor)}</dd>
      </div>
    </dl>
  );
}
