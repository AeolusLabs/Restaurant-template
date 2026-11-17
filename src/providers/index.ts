import { restaurantConfig } from "../../config/restaurant";
import { loadEnv } from "@/lib/env";
import { MockDeliveryProvider } from "./delivery/mock";
import { MockEmailProvider } from "./email/mock";
import { MockLLMProvider } from "./llm/mock";
import { StubNotificationProvider } from "./notification/stub";
import { MockPaymentProvider } from "./payment/mock";
import { PaystackProvider } from "./payment/paystack";
import { getProviders, registerProvider, type Providers } from "./registry";
import { MemoryStorageProvider } from "./storage/memory";

// Local fakes plus the adapters written so far (Paystack). To plug in another service: add
// src/providers/<kind>/<vendor>.ts implementing the interface in ./<kind>/types.ts, register it here, and set
// the matching *_PROVIDER variable. Business logic never changes. To remove a vendor, delete its file and line.
registerProvider("payment", "mock", () => new MockPaymentProvider(restaurantConfig.currency.code));
registerProvider("payment", "paystack", (env) => new PaystackProvider({ secretKey: env.PAYSTACK_SECRET_KEY!, currency: restaurantConfig.currency.code }));
registerProvider("delivery", "mock", () => new MockDeliveryProvider());
registerProvider("notification", "stub", () => new StubNotificationProvider());
registerProvider("email", "mock", () => new MockEmailProvider());
registerProvider("llm", "mock", () => new MockLLMProvider());
registerProvider("storage", "memory", () => new MemoryStorageProvider());

export { getProviders, registerProvider };
export type { Providers };

// Kept on globalThis so every route bundle, and development reloads, share one instance. The mock payment
// provider holds its state in memory, so a second copy would not know about payments started by the first.
const holder = globalThis as typeof globalThis & { __providers?: Providers };

/** The application's providers, built once from the environment on first use. */
export function providers(): Providers {
  return (holder.__providers ??= getProviders(loadEnv()));
}
