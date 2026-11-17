import { loadEnv } from "@/lib/env";
import { MockDeliveryProvider } from "./delivery/mock";
import { MockLLMProvider } from "./llm/mock";
import { StubNotificationProvider } from "./notification/stub";
import { MockPaymentProvider } from "./payment/mock";
import { getProviders, registerProvider, type Providers } from "./registry";
import { MemoryStorageProvider } from "./storage/memory";

// Built-in local fakes. To plug in a real service: add src/providers/<kind>/<vendor>.ts implementing the
// interface in ./<kind>/types.ts, then register it here, for example:
//   registerProvider("payment", "paystack", (env) => new PaystackProvider(env.PAYSTACK_SECRET_KEY!));
// and set PAYMENT_PROVIDER=paystack. Business logic never changes. To remove a vendor, delete its file and line.
registerProvider("payment", "mock", () => new MockPaymentProvider());
registerProvider("delivery", "mock", () => new MockDeliveryProvider());
registerProvider("notification", "stub", () => new StubNotificationProvider());
registerProvider("llm", "mock", () => new MockLLMProvider());
registerProvider("storage", "memory", () => new MemoryStorageProvider());

export { getProviders, registerProvider };
export type { Providers };

let cached: Providers | undefined;

/** The application's providers, built once from the environment on first use. */
export function providers(): Providers {
  return (cached ??= getProviders(loadEnv()));
}
