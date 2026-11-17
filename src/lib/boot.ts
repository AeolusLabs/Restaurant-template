import { getEnabledModules } from "@/modules";
import { loadEnv } from "./env";

/**
 * Everything that must be right before the server takes a request: the environment parses, the config
 * parsed when it was imported, and the enabled modules resolve. Throws a readable error naming the problem.
 */
export function validateBoot(env: Record<string, string | undefined> = process.env): { modules: string[] } {
  loadEnv(env);
  return { modules: getEnabledModules().map((m) => m.id) };
}
