import { describe, expect, test } from "vitest";
import { restaurantConfig } from "../config/restaurant";
import { INSTALLED_MODULES, getEnabledModules, isModuleEnabled } from "../src/modules";
import { ModuleConfigError, resolveModules } from "../src/modules/registry";
import { defineModule } from "../src/modules/types";

const features = { promos: false, pickup: true, delivery: false, ai_agents: false, demo_mode: false };
const ids = (mods: readonly { id: string }[]) => mods.map((m) => m.id);
const mod = (id: string, extra: Partial<Parameters<typeof defineModule>[0]> = {}) =>
  defineModule({ id, description: `${id} module`, ...extra });

describe("resolveModules", () => {
  test("a module whose feature flag is off is excluded, and one whose flag is on is included", () => {
    const all = [mod("pickup", { feature: "pickup" }), mod("delivery", { feature: "delivery" })];
    expect(ids(resolveModules(all, features))).toEqual(["pickup"]);
    expect(ids(resolveModules(all, { ...features, delivery: true }))).toEqual(["pickup", "delivery"]);
  });

  test("a module with no feature flag is always included", () => {
    expect(ids(resolveModules([mod("core")], { ...features, pickup: false }))).toEqual(["core"]);
  });

  test("dependencies are ordered before their dependents, whatever the list order", () => {
    const all = [mod("c", { dependsOn: ["b"] }), mod("a"), mod("b", { dependsOn: ["a"] })];
    expect(ids(resolveModules(all, features))).toEqual(["a", "b", "c"]);
  });

  test("modules with no dependency between them keep the list order", () => {
    expect(ids(resolveModules([mod("z"), mod("m"), mod("a")], features))).toEqual(["z", "m", "a"]);
  });

  test("a duplicate id throws ModuleConfigError naming it", () => {
    expect(() => resolveModules([mod("x"), mod("x")], features)).toThrow(ModuleConfigError);
    expect(() => resolveModules([mod("x"), mod("x")], features)).toThrow(/x/);
  });

  test("an unknown dependency throws ModuleConfigError naming both modules", () => {
    const attempt = () => resolveModules([mod("a", { dependsOn: ["ghost"] })], features);
    expect(attempt).toThrow(ModuleConfigError);
    expect(attempt).toThrow(/a.*ghost/);
  });

  test("a dependency cycle throws ModuleConfigError", () => {
    const all = [mod("a", { dependsOn: ["b"] }), mod("b", { dependsOn: ["a"] })];
    expect(() => resolveModules(all, features)).toThrow(ModuleConfigError);
    expect(() => resolveModules(all, features)).toThrow(/cycle/i);
  });

  test("a module that depends on itself is a cycle", () => {
    expect(() => resolveModules([mod("a", { dependsOn: ["a"] })], features)).toThrow(/cycle/i);
  });

  test("an enabled module that depends on a disabled one throws ModuleConfigError", () => {
    const all = [mod("promos", { feature: "promos" }), mod("campaigns", { dependsOn: ["promos"] })];
    const attempt = () => resolveModules(all, features);
    expect(attempt).toThrow(ModuleConfigError);
    expect(attempt).toThrow(/campaigns.*promos/);
    expect(ids(resolveModules(all, { ...features, promos: true }))).toEqual(["promos", "campaigns"]);
  });

  test("a disabled module that depends on a disabled one is fine", () => {
    const all = [mod("promos", { feature: "promos" }), mod("campaigns", { feature: "promos", dependsOn: ["promos"] })];
    expect(resolveModules(all, features)).toEqual([]);
  });

  test("removing a module from the list that another module depends on fails at resolve time", () => {
    const withBoth = [mod("a"), mod("b", { dependsOn: ["a"] })];
    expect(() => resolveModules(withBoth, features)).not.toThrow();
    expect(() => resolveModules(withBoth.filter((m) => m.id !== "a"), features)).toThrow(ModuleConfigError);
  });
});

describe("defineModule", () => {
  test("rejects an id that is not lower-case kebab-case", () => {
    for (const bad of ["", "Pickup", "has space", "1abc", "a_b"]) {
      expect(() => defineModule({ id: bad, description: "x" }), bad).toThrow(ModuleConfigError);
    }
  });

  test("rejects an empty description", () => {
    expect(() => defineModule({ id: "ok", description: " " })).toThrow(ModuleConfigError);
  });
});

describe("installed modules", () => {
  test("every feature flag in config has exactly one installed module", () => {
    const flags = Object.keys(restaurantConfig.features).sort();
    const used = INSTALLED_MODULES.map((m) => m.feature).filter(Boolean).sort();
    expect(used).toEqual(flags);
  });

  test("the installed modules resolve with every feature on", () => {
    const all = { promos: true, pickup: true, delivery: true, ai_agents: true, demo_mode: true };
    expect(() => resolveModules(INSTALLED_MODULES, all)).not.toThrow();
    expect(resolveModules(INSTALLED_MODULES, all)).toHaveLength(INSTALLED_MODULES.length);
  });

  test("getEnabledModules follows restaurantConfig.features", () => {
    const expected = INSTALLED_MODULES.filter((m) => !m.feature || restaurantConfig.features[m.feature]).map((m) => m.id).sort();
    expect(ids(getEnabledModules()).sort()).toEqual(expected);
    expect(isModuleEnabled("pickup")).toBe(restaurantConfig.features.pickup);
    expect(isModuleEnabled("not-a-module")).toBe(false);
  });

  test("a module that needs a provider names a real provider kind", () => {
    const kinds = new Set(["payment", "delivery", "notification", "llm", "storage"]);
    for (const m of INSTALLED_MODULES) for (const k of m.requiresProviders ?? []) expect(kinds.has(k), `${m.id} requires ${k}`).toBe(true);
  });
});
