import { restaurantConfig } from "../../config/restaurant";
import type { RestaurantConfig } from "../../config/schema";
import { dispatchQueued, queueDeliveries } from "@/delivery/dispatch";
import { syncDeliveries } from "@/delivery/sync";
import { checkWallet } from "@/delivery/wallet";
import { runDueAgents } from "@/agents/schedule";
import { runDemoStream } from "./demo-stream";
import { expireUnpaidOrders } from "./expire-unpaid";
import type { Job } from "./worker";

/** The jobs the worker service runs. Add a line here to schedule another. Delivery jobs run only when delivery is on. */
export function buildJobs(cfg: RestaurantConfig = restaurantConfig): Job[] {
  const jobs: Job[] = [
    {
      name: "expire-unpaid",
      everyMs: 60_000,
      run: async () => {
        const r = await expireUnpaidOrders();
        if (r.expired || r.paid || r.skipped) console.log(`expire-unpaid: ${r.expired} expired, ${r.paid} paid late, ${r.skipped} skipped`);
      },
    },
  ];
  if (cfg.features.delivery) {
    jobs.push(
      {
        // Queues a delivery for each order that reached the dispatch status, then books the ones that are due.
        name: "dispatch-deliveries",
        everyMs: 15_000,
        run: async () => {
          const queued = await queueDeliveries({ config: cfg });
          const r = await dispatchQueued({ config: cfg });
          if (queued || r.booked || r.retried || r.failed) console.log(`dispatch-deliveries: ${queued} queued, ${r.booked} booked, ${r.retried} to retry, ${r.failed} failed`);
        },
      },
      {
        // Polling is the primary source of delivery status: Chowdeck's webhooks are unconfirmed.
        name: "sync-deliveries",
        everyMs: 30_000,
        run: async () => {
          const r = await syncDeliveries();
          if (r.errors) console.log(`sync-deliveries: ${r.checked} checked, ${r.errors} could not be read`);
        },
      },
      { name: "check-wallet", everyMs: 5 * 60_000, run: () => checkWallet({ config: cfg }) },
    );
  }
  if (cfg.features.ai_agents) {
    // Runs the agents that are due (a win-back run a day, say) and closes proposals nobody decided in time.
    jobs.push({
      name: "run-agents",
      everyMs: 5 * 60_000,
      run: async () => {
        const r = await runDueAgents({ config: cfg });
        if (r.ran.length || r.expired) console.log(`run-agents: ran ${r.ran.join(", ") || "nothing"}, ${r.expired} proposals expired`);
      },
    });
  }
  if (cfg.features.demo_mode) {
    // The simulated live order stream. It refuses to run against a real provider, and boot refuses to start with one.
    jobs.push({
      name: "demo-orders",
      everyMs: 20_000,
      run: async () => {
        const r = await runDemoStream({ config: cfg });
        if (r.placed || r.advanced || r.riders) console.log(`demo-orders: ${r.placed} placed, ${r.advanced} moved in the kitchen, ${r.riders} with riders`);
      },
    });
  }
  return jobs;
}

export const jobs: Job[] = buildJobs();
