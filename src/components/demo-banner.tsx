import { restaurantConfig } from "../../config/restaurant";

/** Shown on every screen while demo_mode is on, so nobody mistakes the fictional orders for real ones. */
export function DemoBanner() {
  if (!restaurantConfig.features.demo_mode) return null;
  return (
    <p role="note" className="bg-warn-soft px-4 py-2 text-center text-sm font-semibold text-warn">
      This is a demo. The customers, orders and payments here are fictional: nothing is charged, cooked or delivered.
    </p>
  );
}
