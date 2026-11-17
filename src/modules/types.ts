import type { RestaurantConfig } from "../../config/schema";
import type { AppRole } from "@/domain/roles";
import type { ProviderKey } from "@/providers/registry";

export type FeatureFlag = keyof RestaurantConfig["features"];
export type NavItem = { area: "customer" | "admin"; label: string; href: string; roles: readonly AppRole[] };

/**
 * A manifest for one removable feature. It says what the feature is called, which config flag turns it on,
 * which providers it needs and which other modules it builds on. Core code asks the registry which modules
 * are enabled and never imports a module's folder directly.
 */
export type AppModule = {
  id: string;
  description: string;
  /** The config.features flag that enables it. Omit for a module that is always on. */
  feature?: FeatureFlag;
  requiresProviders?: readonly ProviderKey[];
  dependsOn?: readonly string[];
  nav?: readonly NavItem[];
};

export class ModuleConfigError extends Error {}

const ID = /^[a-z][a-z0-9-]*$/;

export function defineModule(m: AppModule): AppModule {
  if (!ID.test(m.id)) throw new ModuleConfigError(`Module id "${m.id}" must be lower-case kebab-case`);
  if (!m.description.trim()) throw new ModuleConfigError(`Module "${m.id}" needs a description`);
  return Object.freeze({ ...m });
}
