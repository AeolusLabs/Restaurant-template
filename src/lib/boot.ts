import { restaurantConfig } from "../../config/restaurant";
import { getEnabledModules } from "@/modules";
import { EnvError, loadEnv, type Env } from "./env";

/** Demo data is fictional, so a demo must never reach real money, real riders or a paid model. Notifications have no real adapter yet. */
function realProviders(env: Env): string[] {
  const found: string[] = [];
  if (env.PAYMENT_PROVIDER !== "mock") found.push(`PAYMENT_PROVIDER=${env.PAYMENT_PROVIDER}`);
  if (env.DELIVERY_PROVIDER !== "mock") found.push(`DELIVERY_PROVIDER=${env.DELIVERY_PROVIDER}`);
  if (env.NOTIFICATION_PROVIDER !== "stub") found.push(`NOTIFICATION_PROVIDER=${env.NOTIFICATION_PROVIDER}`);
  if (env.LLM_PROVIDER !== "mock") found.push(`LLM_PROVIDER=${env.LLM_PROVIDER}`);
  return found;
}

/**
 * Everything that must be right before the server takes a request: the environment parses, the config
 * parsed when it was imported, the enabled modules resolve, and a demo is not wired to anything real.
 * Throws a readable error naming the problem.
 */
export function validateBoot(env: Record<string, string | undefined> = process.env, features: { demo_mode: boolean } = restaurantConfig.features): { modules: string[] } {
  const parsed = loadEnv(env);
  if (features.demo_mode) {
    const real = realProviders(parsed);
    if (real.length > 0) {
      throw new EnvError(`Demo mode is on, so it will not start with real providers (fictional orders must never reach real money or people). Set these to mock, or turn demo_mode off in config:\n${real.map((r) => `  ${r}`).join("\n")}`);
    }
  }
  return { modules: getEnabledModules().map((m) => m.id) };
}
