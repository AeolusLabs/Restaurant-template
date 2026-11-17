import type { Env } from "@/lib/env";
import type { DeliveryProvider } from "./delivery/types";
import type { EmailProvider } from "./email/types";
import type { LLMProvider } from "./llm/types";
import type { NotificationProvider } from "./notification/types";
import type { PaymentProvider } from "./payment/types";
import type { StorageProvider } from "./storage/types";

export type Providers = {
  payment: PaymentProvider;
  delivery: DeliveryProvider;
  notification: NotificationProvider;
  email: EmailProvider;
  llm: LLMProvider;
  storage: StorageProvider;
};
export type ProviderKey = keyof Providers;
type Factory<K extends ProviderKey> = (env: Env) => Providers[K];

export class ProviderNotInstalledError extends Error {}

const SELECTORS = {
  payment: "PAYMENT_PROVIDER",
  delivery: "DELIVERY_PROVIDER",
  notification: "NOTIFICATION_PROVIDER",
  email: "EMAIL_PROVIDER",
  llm: "LLM_PROVIDER",
  storage: "STORAGE_PROVIDER",
} as const satisfies Record<ProviderKey, keyof Env>;

const factories: { [K in ProviderKey]: Map<string, Factory<K>> } = {
  payment: new Map(),
  delivery: new Map(),
  notification: new Map(),
  email: new Map(),
  llm: new Map(),
  storage: new Map(),
};

/** Adding a vendor is one adapter file plus one call to this in src/providers/index.ts. */
export function registerProvider<K extends ProviderKey>(key: K, name: string, factory: Factory<K>): void {
  (factories[key] as Map<string, Factory<K>>).set(name, factory);
}

function build<K extends ProviderKey>(key: K, env: Env): Providers[K] {
  const name = env[SELECTORS[key]] as string;
  const factory = (factories[key] as Map<string, Factory<K>>).get(name);
  if (!factory) {
    throw new ProviderNotInstalledError(
      `${SELECTORS[key]}=${name} is selected but no adapter is registered. ` +
        `Create src/providers/${key}/${name}.ts and register it in src/providers/index.ts.`,
    );
  }
  return factory(env);
}

/** Builds the providers the environment selects. Each call returns fresh instances. */
export function getProviders(env: Env): Providers {
  return {
    payment: build("payment", env),
    delivery: build("delivery", env),
    notification: build("notification", env),
    email: build("email", env),
    llm: build("llm", env),
    storage: build("storage", env),
  };
}
