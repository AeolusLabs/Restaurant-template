import { restaurantConfig } from "../../config/restaurant";
import agents from "./agents/module";
import delivery from "./delivery/module";
import demo from "./demo/module";
import pickup from "./pickup/module";
import promos from "./promos/module";
import { resolveModules } from "./registry";
import type { AppModule, FeatureFlag } from "./types";

/**
 * Every module this restaurant's codebase ships. To add one: create its folder with a module.ts, import it
 * here and add it to this list. To remove one: delete the folder, the import and the list entry.
 * See docs/modules.md.
 */
export const INSTALLED_MODULES: readonly AppModule[] = [pickup, delivery, promos, agents, demo];

/** The modules turned on by config.features, dependencies first. Throws on a misconfiguration. */
export function getEnabledModules(features: Record<FeatureFlag, boolean> = restaurantConfig.features): readonly AppModule[] {
  return resolveModules(INSTALLED_MODULES, features);
}

export function isModuleEnabled(id: string): boolean {
  return getEnabledModules().some((m) => m.id === id);
}
