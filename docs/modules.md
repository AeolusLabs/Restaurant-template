# Modules and providers

This codebase is a skeleton you plug services and features into. There are two kinds of plug, and both are meant to be added and removed without touching core code.

## Modules (features)

A module is one removable feature: pickup, delivery, promos, agents, demo. Each has a manifest in `src/modules/<name>/module.ts` that says what it is, which `config.features` flag turns it on, which provider kinds it needs and which other modules it builds on.

```ts
export default defineModule({
  id: "loyalty",
  description: "Points for repeat customers.",
  feature: "promos",              // omit for a module that is always on
  requiresProviders: ["notification"],
  dependsOn: ["promos"],
});
```

**Add a module**
1. Create `src/modules/<name>/module.ts` with a manifest like the one above.
2. Import it in `src/modules/index.ts` and add it to `INSTALLED_MODULES`.
3. Add its feature flag to `config/schema.ts` and `config/restaurant.ts` if it needs a new one (a test requires every flag to have exactly one module).
4. Put its code in the same folder. Core code asks `getEnabledModules()` or `isModuleEnabled(id)`; it never imports a module's folder directly.

**Remove a module**
1. Delete its folder, its import and its entry in `INSTALLED_MODULES`.
2. If another module depends on it, startup fails with a message naming both (`Module "x" depends on "y", which is not installed`). Remove or change the dependent first.
3. Drop its feature flag from the config if nothing else uses it.

Misconfiguration (duplicate id, unknown dependency, a cycle, an enabled module that depends on a disabled one) is caught by `resolveModules()` with a message that names the modules, not later at runtime.

## Providers (outside services)

A provider is an adapter for one outside service behind an interface: payments, delivery, notifications, email, a language model, file storage. Business logic only ever sees the interface in `src/providers/<kind>/types.ts`. Every kind has a working fake that runs with no keys and no network, so the whole app runs locally with nothing connected.

| Kind | Interface | Local fake | Selector in `.env` |
|---|---|---|---|
| payment | `PaymentProvider` | `MockPaymentProvider` | `PAYMENT_PROVIDER` |
| delivery | `DeliveryProvider` | `MockDeliveryProvider` | `DELIVERY_PROVIDER` |
| notification | `NotificationProvider` | `StubNotificationProvider` | `NOTIFICATION_PROVIDER` |
| email | `EmailProvider` | `MockEmailProvider` | `EMAIL_PROVIDER` |
| llm | `LLMProvider` | `MockLLMProvider` | `LLM_PROVIDER` |
| storage | `StorageProvider` | `MemoryStorageProvider` | `STORAGE_PROVIDER` |

**Plug in a real service** (for example Paystack)
1. Create `src/providers/payment/paystack.ts` with a class that implements `PaymentProvider`. It is the only file that may import the vendor's SDK (a test enforces this).
2. Register it in `src/providers/index.ts`: `registerProvider("payment", "paystack", (env) => new PaystackProvider(env.PAYSTACK_SECRET_KEY!))`.
3. Set `PAYMENT_PROVIDER=paystack` and the vendor's keys in `.env`. Env validation already requires the keys when a real provider is selected.

Until step 1 and 2 are done, selecting a real vendor fails at startup with `ProviderNotInstalledError`, naming the file to create. Nothing silently falls back to the fake.

**Email.** The fake prints each message to the server log (so a developer can copy a password reset link) and sends nothing. To send real email, add an adapter for your provider (SMTP, Resend, Postmark) as `src/providers/email/<name>.ts`, add its name to the `EMAIL_PROVIDER` list in `src/lib/env.ts`, register it, and set the variable. Until then password reset emails are never delivered.

**Remove a service:** delete its adapter file and its `registerProvider` line, and set the selector back to the fake.

The language model adapter (`src/providers/llm/anthropic.ts`) exists but has never run against the live API; set the model and its price on purpose (docs/runbook.md section 14).

Adapters map the vendor's vocabulary onto the interface's (for example Chowdeck's statuses onto `DeliveryStatus`) and throw the shared error classes (`WebhookSignatureError`, `QuoteExpiredError`, `InsufficientWalletError`). The Chowdeck adapter exists (`src/providers/delivery/chowdeck.ts`) but has never run against the live API; `docs/ARCHITECTURE.md` sections 10 and 23 list what to confirm.

## What stays fixed

The order state machine, the money module, row-level security and the request context are core. They are not modules, because every feature depends on them.
