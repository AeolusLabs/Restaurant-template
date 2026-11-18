import { describe, expect, test } from "vitest";
import { restaurantConfig } from "../config/restaurant";
import type { RestaurantConfig } from "../config/schema";
import { buildJobs } from "../src/jobs";

const withDelivery = (on: boolean): RestaurantConfig => ({ ...restaurantConfig, features: { ...restaurantConfig.features, delivery: on } });

const withAgents = (on: boolean): RestaurantConfig => ({ ...restaurantConfig, features: { ...restaurantConfig.features, ai_agents: on } });

describe("buildJobs", () => {
  test("a restaurant without delivery runs only the order expiry job", () => {
    expect(buildJobs(withDelivery(false)).map((j) => j.name)).toEqual(["expire-unpaid"]);
  });

  test("with delivery on, the worker also books riders, follows deliveries and checks the wallet", () => {
    expect(buildJobs(withDelivery(true)).map((j) => j.name)).toEqual(["expire-unpaid", "dispatch-deliveries", "sync-deliveries", "check-wallet"]);
  });

  test("every job has a sensible interval, and polling is not slower than a customer would notice", () => {
    const jobs = Object.fromEntries(buildJobs(withDelivery(true)).map((j) => [j.name, j.everyMs]));
    for (const ms of Object.values(jobs)) expect(ms).toBeGreaterThanOrEqual(5_000);
    expect(jobs["dispatch-deliveries"]).toBeLessThanOrEqual(30_000);
    expect(jobs["sync-deliveries"]).toBeLessThanOrEqual(60_000);
    expect(jobs["check-wallet"]).toBeLessThanOrEqual(15 * 60_000);
  });

  test("the agent runner is scheduled only when agents are switched on", () => {
    expect(buildJobs(withAgents(false)).map((j) => j.name)).not.toContain("run-agents");
    const job = buildJobs(withAgents(true)).find((j) => j.name === "run-agents");
    expect(job?.everyMs).toBeLessThanOrEqual(10 * 60_000);
  });
});
