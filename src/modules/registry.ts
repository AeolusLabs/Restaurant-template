import type { RestaurantConfig } from "../../config/schema";
import { ModuleConfigError, type AppModule } from "./types";

export { ModuleConfigError };

/**
 * Returns the enabled modules with dependencies ahead of their dependents. Anything misconfigured
 * (duplicate id, unknown dependency, cycle, an enabled module resting on a disabled one) fails here,
 * at startup, with a message that names the modules involved, never later at runtime.
 */
export function resolveModules(all: readonly AppModule[], features: RestaurantConfig["features"]): readonly AppModule[] {
  const byId = new Map<string, AppModule>();
  for (const m of all) {
    if (byId.has(m.id)) throw new ModuleConfigError(`Duplicate module id "${m.id}"`);
    byId.set(m.id, m);
  }
  for (const m of all) {
    for (const dep of m.dependsOn ?? []) {
      if (!byId.has(dep)) throw new ModuleConfigError(`Module "${m.id}" depends on "${dep}", which is not installed`);
    }
  }

  // Depth-first order over every module, so a cycle is caught even among disabled ones.
  const order: AppModule[] = [];
  const done = new Set<string>();
  const visiting: string[] = [];
  const visit = (m: AppModule) => {
    if (done.has(m.id)) return;
    if (visiting.includes(m.id)) {
      throw new ModuleConfigError(`Module dependency cycle: ${[...visiting.slice(visiting.indexOf(m.id)), m.id].join(" -> ")}`);
    }
    visiting.push(m.id);
    for (const dep of m.dependsOn ?? []) visit(byId.get(dep)!);
    visiting.pop();
    done.add(m.id);
    order.push(m);
  };
  for (const m of all) visit(m);

  const enabled = (m: AppModule) => !m.feature || features[m.feature];
  for (const m of all) {
    if (!enabled(m)) continue;
    for (const dep of m.dependsOn ?? []) {
      if (!enabled(byId.get(dep)!)) {
        throw new ModuleConfigError(`Module "${m.id}" is enabled but depends on "${dep}", which is disabled (feature "${byId.get(dep)!.feature}")`);
      }
    }
  }
  return order.filter(enabled);
}
