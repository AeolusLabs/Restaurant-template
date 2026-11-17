import { expireUnpaidOrders } from "./expire-unpaid";
import type { Job } from "./worker";

/** The jobs the worker service runs. Add a line here to schedule another. */
export const jobs: Job[] = [
  {
    name: "expire-unpaid",
    everyMs: 60_000,
    run: async () => {
      const r = await expireUnpaidOrders();
      if (r.expired || r.paid || r.skipped) console.log(`expire-unpaid: ${r.expired} expired, ${r.paid} paid late, ${r.skipped} skipped`);
    },
  },
];
