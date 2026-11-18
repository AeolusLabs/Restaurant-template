# restaurant-template: Architecture

Status: **Phase 0 draft, awaiting approval.** No application code exists yet.
Companion files: `CLAUDE.md` (the rules), `PRODUCT.md` (users, personality, design principles).
Visual version of this document: the architecture artifact (stack, code layers, order lifecycle, data model, permissions, agent flow).

## 1. What this is

A single-tenant restaurant ordering platform: a customer site and an admin site, deployed once per restaurant. The first deployment is a real client. Later restaurants start from this repo. It is not multi-tenant, there is no `tenant_id`, and multi-tenancy is a possible future project.

Everything that differs between restaurants is either configuration (`config/restaurant.ts`), a secret (`.env`), or data (the database).

## 2. Stack and hosting

| Layer | Choice | Notes |
|---|---|---|
| App | Next.js App Router, TypeScript, Tailwind | Standalone build, Node runtime for anything touching webhooks or the database |
| Validation | Zod | Config, env, API input, provider responses |
| Tests | Vitest | State machine, money, promos, webhook idempotency, RLS |
| Package manager | pnpm | Node 22 LTS pinned in `.nvmrc` and `engines` |
| Database | PostgreSQL 18 on Railway | Private network, PgBouncer for web traffic, backups and PITR on |
| Data access | Drizzle ORM + drizzle-kit | Table DDL generated, RLS, roles, triggers and seeds as custom SQL migrations. **Confirm in the Phase 1 spike.** |
| Auth | Better Auth | Runs inside Next.js, sessions in Postgres. **Confirm in the Phase 1 spike.** |
| Jobs and schedules | pg-boss | Plain Postgres, no extensions. Runs in the worker service |
| Realtime | Postgres LISTEN/NOTIFY + Server-Sent Events | Polling fallback on the client |
| Files | Railway Bucket (S3-compatible, private) behind `StorageProvider` | Served through a Next route with cache headers |
| Payments | Paystack | Behind `PaymentProvider` |
| Delivery | Chowdeck Relay | Behind `DeliveryProvider` |
| Edge | Cloudflare | Registrar, DNS, proxy, TLS, WAF, rate limits, Turnstile, optional Access |

Railway project: `web` service, `worker` service, Postgres 18 with PgBouncer, one bucket. The web service is the only public service. Both services use the same repo and image, with different start commands.

The build is host-agnostic (`output: 'standalone'`, a `Dockerfile`, no vendor-specific APIs in business logic), so a move to another container host is a deploy change.

## 3. Folder structure

```
restaurant-template/
  CLAUDE.md
  PRODUCT.md
  docs/
    ARCHITECTURE.md
    runbook.md                 backups, PITR restore, secret rotation (Phase 1)
  config/
    restaurant.ts              the only place for client-specific values
    schema.ts                  Zod schema that validates restaurant.ts at boot
  db/
    migrations/                numbered SQL, applied in order (Drizzle journal)
    seed/
      menu.ts                  small seed menu (built)
      owner.ts                 first owner from INITIAL_OWNER_* (built)
      demo.ts                  demo_mode data (Phase 9)
  scripts/                     db-local, db-bootstrap, migrate, seed, auth schema, matrix SQL generator (built)
  src/
    instrumentation.ts         validates env and modules when the server starts (built)
    proxy.ts                   origin lock and security headers (built; Next 16 name for middleware)
    modules/                   removable features, see docs/modules.md (built)
    app/
      (customer)/              menu, cart, checkout, orders, account
      (admin)/admin/           dashboard, menu, orders, staff, customers, promos, qr, agents
      (kitchen)/kitchen/       kitchen display
      api/
        webhooks/payment/       provider-agnostic payment webhook (built)
        webhooks/chowdeck/
        stream/orders/         Server-Sent Events
        media/[...key]/        bucket proxy
        me/export/             customer data export
    domain/                    pure business logic, no vendor SDKs, no HTTP
      orders/                  transitions.ts, create-order.ts
      pricing/                 totals, tax, service charge, delivery fee
      checkout/
      promos/
      delivery/
      agents/
    providers/                 one folder per interface
      payment/    types.ts  paystack.ts  mock.ts
      delivery/   types.ts  chowdeck.ts  mock.ts
      notification/ types.ts  stub.ts
      llm/        types.ts  (a real implementation later)  mock.ts
      storage/    types.ts  s3.ts  memory.ts
      index.ts                 picks implementations from env
    db/
      schema/                  Drizzle table definitions
      context.ts               withRequestContext(), the only query handle
    auth/                      Better Auth setup, session helpers, requireRole()
    jobs/                      worker entry and job handlers
    realtime/                  NOTIFY listener, SSE fan-out
    lib/
      money.ts                 integer minor-unit helpers
      sanitize.ts              toPublicUser() and other public serializers
      scrub.ts                 key stripper, applied per route handler with withScrub()
      perimeter.ts, env.ts, boot.ts, format-issues.ts
  tests/
```

`domain/` imports `providers/*/types.ts` only, never an implementation or a vendor SDK.

## 4. Configuration and environment

**`config/restaurant.ts`**, validated by Zod at boot (the app refuses to start on an invalid config):

- Identity: `name`, `logo`, `colors` (tokens), `contact`, `address`.
- Locale: `currency` (code and minor-unit exponent), `timezone`, `locale`.
- `openingHours` per weekday with optional breaks and holiday overrides.
- `pickup`: slot length, minimum lead time, last-order cutoff.
- `delivery`: `zones[]` (name, shape, fee rule), `dispatchOn` (`accepted` by default), quote handling.
- `charges`: `serviceChargeBps`, `taxBps`, and whether prices include them.
- `orders`: unpaid-expiry minutes, cancellation window.
- `features`: `promos`, `pickup`, `delivery`, `ai_agents`, `demo_mode`.
- `agents`: default monthly spend cap per agent, model price table for cost accounting.

**`.env`** (secrets and per-environment wiring only; `.env.example` is committed):

```
DATABASE_URL                pooled, app role
DATABASE_UNPOOLED_URL       direct, app role (LISTEN/NOTIFY, pg-boss)
DATABASE_SYSTEM_URL         direct, system role (webhooks, jobs)
DATABASE_MIGRATOR_URL       direct, migrator role (migrations only)
BETTER_AUTH_SECRET, APP_URL
PAYMENT_PROVIDER=paystack|mock   PAYSTACK_SECRET_KEY, PAYSTACK_PUBLIC_KEY
DELIVERY_PROVIDER=chowdeck|mock  CHOWDECK_API_KEY, CHOWDECK_BASE_URL, CHOWDECK_WEBHOOK_SECRET
NOTIFICATION_PROVIDER=stub
LLM_PROVIDER=mock
STORAGE_PROVIDER=s3|memory       S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY
TURNSTILE_SECRET_KEY, ORIGIN_LOCK_SECRET
```

**Commands** (the "migrate, seed, run" requirement):

```
pnpm setup        migrate, then seed the small menu
pnpm dev          web and worker together
pnpm db:migrate   apply pending migrations
pnpm db:seed      seed menu (idempotent)
pnpm db:seed:demo demo data (only when features.demo_mode)
pnpm test
```

## 5. Data model

All money columns are `bigint`, in the minor unit, and end in `_minor`. IDs are UUIDs (PostgreSQL 18 `uuidv7()` where available). Tables are created in the phase that needs them.

**Identity (Phase 1)**
- Better Auth tables (`user`, `session`, `account`, `verification`). Application code never selects from these directly. Password hashes live in `account`.
- `profiles`: `id` (= auth user id), `role` (`owner|manager|kitchen|customer`, default `customer`), `full_name`, `phone`, `blocked_at`, `deleted_at`.
- `addresses`: `profile_id`, `label`, `line1`, `area`, `city`, `lat`, `lng`, `is_default`.
- `consents`: `profile_id`, `type` (`terms|privacy|marketing`), `policy_version`, `granted_at`, `withdrawn_at`.
- `data_requests`: `profile_id`, `kind` (`export|delete`), `status`, timestamps.

**Menu (Phase 1 schema, Phase 3 admin)**
- `menu_categories`, `menu_items` (`price_minor`, `available` for the sold-out toggle, `active`, `image_key`), `modifier_groups` (min and max selections), `modifiers` (`price_delta_minor`).

**Orders (Phase 1 schema, Phase 2 use)**
- `orders`: `public_code`, `profile_id`, `customer_name`, `status`, `fulfilment` (`pickup|delivery`), `pickup_at`, `subtotal_minor`, `discount_minor`, `service_charge_minor`, `tax_minor`, `delivery_fee_minor`, `total_minor`, `currency`, `promo_id`, `source_id` (QR), `resume_state`, `expires_at`.
- `order_contacts`: `order_id` (unique), `phone`, `address_snapshot`. Kept apart from `orders` so RLS can hide contact details from the kitchen role. `orders` keeps only `customer_name`. All app roles share one database role, so column-level grants cannot do this job.
- `order_items`: `name_snapshot`, `unit_price_minor_snapshot`, `quantity`, `modifiers_snapshot`, `line_total_minor`. Copied at order time so menu edits never change a past order.
- `order_events`: append-only log of every transition (`from_status`, `to_status`, `actor_type`, `actor_id`, `reason`, `meta`).
- `order_transitions`: the allowed-transition matrix, seeded by migration (section 7).

**Money**
- `payments`: `order_id`, `provider`, `reference` (**unique**), `amount_minor`, `status`.
- `refunds`: `payment_id`, `amount_minor`, `reason`, `status`, `created_by`.
- `webhook_events`: `provider`, `event_id`, `event_type`, `payload`, `received_at`, `processed_at`, **unique (`provider`, `event_id`)**.

**Delivery (Phase 4)**
- `deliveries`: `order_id` (unique), `provider_ref`, `quote_id`, `fee_charged_minor` (what the customer paid), `provider_cost_minor` (what Chowdeck charged), `status`, `tracking_url`, `failure_reason`.
- `wallet_snapshots`: `balance_minor`, `checked_at`.
- `alerts`: `kind`, `severity`, `payload`, `resolved_at` (low wallet, delivery failed).

**Later phases**: `promos` and `promo_redemptions` (5), `qr_sources` (6), `agent_configs`, `agent_runs`, `agent_proposals` (8), `audit_log` (from Phase 1, used by staff actions and agents).

## 6. Money

- One module, `lib/money.ts`: integer arithmetic only, rounding rules in one place (basis-point math rounds half up, documented), formatting from config currency.
- No `number` with decimals anywhere in the domain, no floats in the database.
- The server prices every order from the database and config. The client sends item IDs, modifier IDs and quantities, never prices.
- Provider amounts are converted at the adapter boundary. Paystack and Chowdeck both use the minor unit.

## 7. Order state machine

```
placed -> paid -> accepted -> preparing -> ready -> out_for_delivery -> completed
                                                \-> picked_up ------> completed
```

| From | To | Who | Condition |
|---|---|---|---|
| placed | paid | system | Verified Paystack payment, amount matches |
| placed | cancelled | system, customer | Unpaid expiry, or customer abandons |
| paid | accepted | manager, owner, kitchen | |
| paid, accepted | cancelled | manager, owner (customer only before accepted) | Refund follows |
| accepted | preparing | kitchen, manager, owner | |
| preparing | ready | kitchen, manager, owner | |
| ready | out_for_delivery | system | Delivery orders; provider reports pickup |
| ready | picked_up | kitchen, manager, owner | Pickup orders |
| out_for_delivery, picked_up | completed | system, manager, owner | Provider reports delivered, or staff or timer for pickup |
| accepted, preparing, ready, out_for_delivery | delivery_failed | system | Delivery creation or delivery itself fails |
| delivery_failed | `resume_state` | manager, owner | Admin retries |
| delivery_failed | cancelled | manager, owner | Admin gives up |
| cancelled, completed | refunded | manager, owner | Money returned through the payment provider |

`delivery_failed` is an addition to the chain in the project rules. A paid order whose delivery cannot be created needs a state an admin can act on, and `resume_state` records where to return to.

**Enforcement, in one place:**
- `src/domain/orders/transitions.ts` owns the matrix and the only exported function that changes `orders.status`: `transitionOrder(orderId, to, actor, meta)`. Nothing else writes that column.
- `order_transitions` is the database copy, seeded by migration. A trigger on `orders` rejects any status change not in the table, and writes the `order_events` row.
- A Vitest test fails if the TypeScript matrix and the seeded table differ.
- Staff and customers have no `UPDATE` privilege on `orders.status` at all (section 11).

## 8. Checkout and payment flow (pickup first, Phase 2)

1. Cart on the client holds item IDs and quantities.
2. Checkout calls a server action: validates input with Zod, prices the cart from the database, applies config charges, picks a pickup slot, and creates the order as `placed` with `expires_at`, in one transaction.
3. The server calls `PaymentProvider.initialize()` with the order total, and returns the Paystack authorization URL.
4. The customer pays on Paystack. The redirect back to the site is **not proof of payment**. The confirmation page polls the order status.
5. Paystack posts a webhook. The handler verifies the signature, deduplicates, verifies the transaction with the provider, checks amount and currency against the order, then calls `transitionOrder(placed -> paid)`.
6. `order_events` insert fires NOTIFY, which reaches the kitchen feed and the customer's tracking page.
7. A worker job expires unpaid orders after `orders.unpaidExpiryMinutes`.

Delivery orders (Phase 4) add a quote at checkout for display, and a fresh quote at dispatch time.

## 9. Provider interfaces

Business logic imports types only. Implementations are chosen in `providers/index.ts` from env. Every interface has a mock used in development and tests.

```ts
interface PaymentProvider {
  initialize(i: { orderId: string; amountMinor: number; email: string; reference: string; callbackUrl: string }):
    Promise<{ authorizationUrl: string; reference: string }>;
  verify(reference: string): Promise<{ status: 'success'|'failed'|'abandoned'; amountMinor: number; currency: string }>;
  parseWebhook(rawBody: string, headers: Headers): PaymentEvent;   // throws on a bad signature
  refund(i: { reference: string; amountMinor: number; reason?: string }): Promise<{ providerRef: string }>;
}

interface DeliveryProvider {
  getQuote(i: DeliveryQuoteInput): Promise<{ quoteId: string; feeMinor: number; expiresAt?: Date }>;
  createDelivery(i: DeliveryCreateInput & { quoteId: string; reference: string }):
    Promise<{ providerRef: string; status: DeliveryStatus; trackingUrl?: string; costMinor: number }>;
  getDelivery(providerRef: string): Promise<{ status: DeliveryStatus; raw: unknown }>;
  cancel(providerRef: string, reason: string): Promise<{ refundMinor?: number }>;
  getWalletBalance(): Promise<{ balanceMinor: number }>;
  parseWebhook(rawBody: string, headers: Headers): DeliveryEvent;  // throws on a bad signature
}
// DeliveryStatus: pending | awaiting_pickup | in_transit | delivered | cancelled | failed | unknown

interface EmailProvider {
  send(i: { to: string; subject: string; text: string }): Promise<void>;
}

interface NotificationProvider {
  send(i: { channel: 'sms'|'whatsapp'; to: string; template: string; vars: Record<string, string> }): Promise<void>;
}

interface LLMProvider {
  complete<T>(i: { system: string; messages: Msg[]; schema: ZodType<T>; maxOutputTokens: number }):
    Promise<{ output: T; usage: { inputTokens: number; outputTokens: number } }>;
}

interface StorageProvider {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  getStream(key: string): Promise<{ stream: ReadableStream; contentType: string } | null>;
  delete(key: string): Promise<void>;
}
```

Adapters normalise provider vocabulary into the internal enums and never leak vendor field names upward. Unknown provider values map to `unknown` and are logged.

## 10. Chowdeck Relay findings

Source: 19 pages of the Chowdeck docs, read on 2026-11-17. The docs contradict themselves in places, so the adapter treats Relay as unverified until a live call proves each point.

| Item | What the docs say | Handling |
|---|---|---|
| **Base URL** | Conflict. Reference pages: `https://api.chowdeck.com`. Guides: `https://api.relay.chowdeck.com`. Same `/relay/...` paths. No page says which is current. | `CHOWDECK_BASE_URL` has no default. Needs one call to each host with a real key. **Blocker for Phase 4.** |
| Auth | `Authorization: Bearer <secret key>` | |
| Quote | `POST /relay/delivery/fee`, returns `data.id` (the fee ID) and `total_amount` | Re-quote at dispatch, never reuse the checkout quote |
| Quote expiry | No duration documented. Create returns "This delivery fee has expired." | Detect that error and re-quote once |
| Create | `POST /relay/delivery` with `fee_id`, contacts, `item_type`, `user_action` | Send the strict superset of fields; `country_code` is required in one place and optional in another |
| Status | `GET /relay/delivery/{reference}`. Three conflicting status vocabularies across polling, cancel and webhook docs. | Adapter maps all to `DeliveryStatus` |
| Webhooks | `x-chowdeck-signature`, HMAC-SHA256 over the raw body. The docs do not say where the secret comes from, or whether Relay deliveries fire these events. | Polling is the primary status source until confirmed. **Blocker for webhook handling.** |
| Wallet | `GET /relay/wallet/balance`, in kobo. | Scheduled check, low-balance alert |
| Insufficient wallet | Documented only for redelivery. Create and quote have no documented error. | Any create failure after payment goes to `delivery_failed` |
| Cancel and redelivery | `POST /relay/delivery/{reference}/cancel`, `POST /relay/redelivery/fee`, `POST /relay/redelivery` | Admin resolution actions |
| Sandbox | None found. | The mock implementation carries development and CI. Live testing spends real wallet money. |

## 11. Auth, RBAC and RLS

**Roles** (`profiles.role`): `owner`, `manager`, `kitchen`, `customer`. Staff roles are created only by an owner.

**Database roles**
- `migrator`: owns the tables, runs migrations. Never used at runtime.
- `app`: used for user requests. Not the owner, no `BYPASSRLS`. Every table has `ENABLE` and `FORCE ROW LEVEL SECURITY`.
- `system`: used by webhooks and jobs. Policies grant it exactly what those handlers need. No `BYPASSRLS`.

**Request context.** `withRequestContext(session, fn)` is the only way to get a query handle. It opens a transaction and runs `set_config('app.user_id', ..., true)` and `set_config('app.role', ..., true)`, so the setting dies with the transaction and is safe through PgBouncer's transaction mode. Policies read it through a helper `current_app_role()`. A lint rule forbids importing the raw pool outside `db/context.ts`. **No context means every policy evaluates to false**, so a forgotten wrapper returns zero rows.

**Policy summary**

| Table | customer | kitchen | manager | owner |
|---|---|---|---|---|
| profiles | own row (not `role`) | own | read all, block/unblock | all, change roles |
| addresses, consents | own | none | read | read |
| menu_* | read active | read | write | write |
| orders, order_items | read own | read active orders | read all | read all |
| order_contacts | read own | none | read all | read all |
| order_events | read own order's | read active | read | read |
| payments, refunds | read own | none | read | read |
| deliveries, alerts | read own delivery | none | read, resolve | read, resolve |
| webhook_events | none | none | none | none (system only) |
| promos, qr_sources | none | none | write | write |
| agent_* | none | none | read, decide | all |
| audit_log | none | none | none | read |

- `orders` has no `UPDATE` grant for `app` on `status`. Transitions go through a `SECURITY DEFINER` function that `transitionOrder()` calls, which checks the actor's role against `order_transitions` and writes the event.
- Kitchen reads `orders` and `order_items` but has no access to `order_contacts` (phone and address), so contact details are denied by policy, not by convention.
- Tests run as each role and assert both what is allowed and what is denied.

**Sensitive fields.** Password hashes, reset and verification tokens, and API secrets never leave the server. `lib/sanitize.ts` exports `toPublicUser()` and the other public serializers, and every response goes through them. `lib/scrub.ts` is middleware that recursively strips a known list of sensitive keys from every outgoing JSON body, so a handler that forgets still cannot leak. Both exist from Phase 1.

**Sessions.** Any handler that regenerates or saves a session sends its response inside that callback, or awaits it, never after it.

**Account protection.** Turnstile on signup, login and checkout, verified server-side. Rate limits at Cloudflare and again in the app for login.

## 12. Realtime and jobs

**Realtime**
- A trigger on `order_events` calls `pg_notify('order_events', {order_id, to_status})`.
- One listener per web instance, on `DATABASE_UNPOOLED_URL`, fans events out to open SSE streams, filtered by role.
- A comment line every 25 seconds keeps Cloudflare's idle timeout from closing the stream.
- NOTIFY is not durable. The client refetches on reconnect and polls every few seconds as a fallback.

**Jobs (pg-boss, worker service)**
- Unpaid-order expiry, pickup auto-complete.
- Delivery dispatch (queued when the order reaches `dispatchOn`, default `accepted`), with retries and backoff.
- Delivery status polling, wallet balance check and low-balance alert.
- Notification sends.
- Agent runs.
- Job handlers are idempotent and carry the order ID, never a stale snapshot.

## 13. Webhooks

Both handlers: `runtime = 'nodejs'`, read the raw body before parsing, verify the signature, then insert into `webhook_events` with `ON CONFLICT (provider, event_id) DO NOTHING`. Only a newly inserted event is processed, inside the same transaction as the state change. A replay changes nothing.

- **Paystack:** `x-paystack-signature` is an HMAC-SHA512 of the raw body with the secret key. Idempotency key from the event type and transaction reference. The handler also calls `verify()` and compares amount and currency to the order before `placed -> paid`.
- **Chowdeck:** `x-chowdeck-signature`, HMAC-SHA256 over the raw body. Secret location unconfirmed (section 10).
- Signature comparison uses a constant-time function. A bad signature returns 401 and stores nothing.
- Cloudflare skips bot checks on these two paths. The signature is the gate there.

## 14. NDPR and GDPR

- Consent is captured at signup (terms, privacy, optional marketing), with policy version and timestamp, in `consents`.
- **Export:** `/api/me/export` returns the customer's profile, addresses, consents, orders and events as JSON.
- **Deletion:** anonymises the profile (name, phone, email removed), deletes addresses and sessions, removes the auth user, and keeps order and payment rows with the personal fields stripped, because those are financial records. Logged in `data_requests`.
- Staff can trigger both on a customer's behalf, with an `audit_log` entry.

## 15. AI agent framework (Phase 8)

Built first, agents after (customer win-back and WhatsApp agents first, then the rest).

- `agent_configs`: per agent `enabled`, `autonomy` (`suggest_only|approve_first|auto`, default `suggest_only`), `monthly_cap_minor`.
- `Agent` contract: `{ key, triggers, run(ctx) -> Proposal[] }`. An agent never performs side effects directly. It returns proposals.
- `agent_proposals`: `kind`, `payload`, `customer_facing`, `status` (`pending|approved|rejected|executed|expired`), `decided_by`.
- A registry maps each proposal `kind` to an executor. `suggest_only` stores the proposal as advice. `approve_first` waits in the queue and runs the executor on approval. `auto` runs the executor immediately.
- **Customer-facing kinds** require `auto` to be set explicitly per agent, with a separate confirmation. Nothing customer-facing is sent otherwise.
- **Spend cap:** `LLMProvider` is the only way to call a model. Before each call the framework sums this month's `agent_runs.cost_minor` plus an estimate for the call, and refuses if it would pass the cap. After the call it records tokens and cost from the config price table.
- Every run writes an `agent_runs` row and an `audit_log` entry, whichever branch it takes.
- Agents: demand and prep planner, menu engineer, win-back, WhatsApp ordering and support, delivery watchdog, anomaly and abuse detector.

## 16. Security perimeter

- Cloudflare is the registrar and DNS host. The proxy hides the Railway origin, terminates TLS (Full strict), caches static files and menu images, and runs WAF, bot protection and rate limits. Cloudflare Access can gate `/admin` and `/kitchen` as an extra layer (optional).
- **Origin lock:** a Cloudflare Transform Rule adds a secret header (`ORIGIN_LOCK_SECRET`) to every proxied request. Next.js middleware rejects requests without it, so Railway's public URL cannot bypass the WAF.
- Security headers (CSP, HSTS, frame, referrer, content-type) set in Next.js middleware.
- Secrets only in Railway variables and local `.env`. Rotation steps in `docs/runbook.md`.
- Backups and PITR are switched on at provisioning, and the restore procedure is rehearsed once before launch.

## 17. Testing plan

Required before the relevant phase is approved:
- **State machine:** every allowed transition, every disallowed one, role checks, the TypeScript matrix against the seeded table, and a database-level rejection test.
- **Money:** integer math, rounding, tax and service charge in both inclusive and exclusive modes, formatting, cents-to-kobo adapter conversions.
- **Promo calculation** (Phase 5): percentage, fixed, free delivery, usage limits, expiry, minimum order, stacking rules.
- **Webhook idempotency:** replayed event, concurrent duplicate delivery, bad signature, valid signature with a mismatched amount.
- **RLS:** per role, allowed and denied, including the no-context case.
- **Response scrubber:** a known sensitive key is stripped at any depth.
- Provider contract tests run against the mocks and, when credentials exist, against the real services.

## 18. Phases

Each phase ends with a stop for your approval.

| Phase | Scope |
|---|---|
| 0 | This document and `CLAUDE.md`. Investigate the Chowdeck docs. No app code. |
| 1 | Three spikes (provision PG 18 and confirm the version, the RLS request-context proof, Better Auth), then scaffold, config system, schema, migrations, seed, auth, RBAC, sanitizer and scrubber, runbook. |
| 2 | Customer side: accounts, menu, cart, pickup checkout with Paystack, order tracking. |
| 3 | Admin core: staff CRUD, menu management, order management, kitchen display. |
| 4 | Chowdeck delivery: zones, quotes, creation, webhooks, tracking, failure paths, wallet alert. |
| 5 | Promos and customer management. |
| 6 | QR codes with source attribution. |
| 7 | BI dashboard. |
| 8 | Agent framework, then win-back and WhatsApp agents. |
| 9 | Remaining agents, `demo_mode`, simulated order stream, `seed:demo`. |

## 19. Open decisions and blockers

**Blocked on you or the client**
1. **Chowdeck base URL.** One call to each host with a real key settles it. Blocks Phase 4.
2. **Chowdeck webhook secret** location, and whether Relay deliveries fire webhooks. Polling is the fallback.
3. **Railway access.** A Railway account and project, so Phase 1 can provision PG 18 and apply migrations.

**Defaults I chose, change if wrong**
4. Delivery is dispatched when staff accept the order (`dispatchOn: accepted`), so rider timing follows the cooking.
5. Unpaid orders expire after 30 minutes.
6. Customers can cancel only before acceptance. After that, staff decide.
7. Delivery fee charged to the customer comes from a config zone fee. Any difference from Chowdeck's quote is absorbed by the restaurant and recorded.
8. Accounts are required to order. There is no guest checkout.
9. Prices include tax and service charge unless config says otherwise.

**Resolved in Phase 1** (details in `docs/spikes.md`)
11. Better Auth 1.7 works as designed for email and password, with UUID ids. Phone OTP and account deletion are later phases.
12. Drizzle with custom SQL migrations works for roles, RLS, functions and triggers. Tables come from `drizzle-kit generate`, the rest from `--custom`.

**Still to verify on Railway**
10. PostgreSQL 18 image tag on Railway, and which plans include backups and PITR. PgBouncer in transaction mode with the request context.
13. Which SSL mode works for a Railway custom domain behind the Cloudflare proxy, and whether to disable Railway's public URL.
14. Cloudflare plan limits for custom WAF rules, rate limits and Access seats.
15. If the client wants a `.ng` domain: Cloudflare Registrar may not sell it, so register with a NiRA-accredited registrar and point the nameservers at Cloudflare.

## 20. Phase 1 implementation notes

What was built differs from the Phase 0 text in these ways. Each is also recorded as a ruling in the build ledger.

- **Local database.** Docker is not required. `embedded-postgres` runs a real PostgreSQL 18 for development (`pnpm db:local`, port 55432) and for tests (a throwaway cluster per run). `bootstrapRoles` refuses anything that is not real PostgreSQL 18, and the dev port guard refuses a busy port, after a port collision with another project's database (see `docs/spikes.md`).
- **`transitionOrder()`** lives in `src/db/transition-order.ts`. The pure matrix, `canTransition` and the error classes stay in `src/domain/orders/transitions.ts` so `domain/` has no database imports. The database function `transition_order()` takes the actor from the request context, never from an argument.
- **SECURITY DEFINER functions** (`transition_order`, `set_profile_role`, `block_profile`) run as the migrator, which `FORCE ROW LEVEL SECURITY` binds. Tables they touch have a `TO migrator` policy gated on a transaction-local flag `app.definer_ok`, set inside the function. A future data migration that edits those tables must set the same flag.
- **Profile role and blocked state** change only through `set_profile_role()` and `block_profile()`. Column-level grants let the app role update `full_name` and `phone` only.
- **Menu is public.** Active menu rows are readable with no identity, because visitors browse before signing in. Every other table returns nothing without a context.
- **Auth tables** (`user`, `session`, `account`, `verification`) are readable only by the `system` role. Better Auth runs as `system`.
- **Sign-up.** Better Auth cannot join our transaction, so `signUpCustomer()` creates the user, then the profile and consents, and removes the user if the second step fails. The public `/sign-up/email` HTTP route is refused by a `hooks.before` rule.
- **Sensitive-field scrubbing** is `withScrub()` on route handlers, because Next.js `proxy.ts` cannot rewrite response bodies. `SENSITIVE_KEYS` also covers `token`, `accessToken`, `refreshToken` and `idToken`.
- **No `runtime` export.** Next.js 16 with Cache Components makes Node the only runtime and forbids the export. A test enforces that none exists.
- **Security headers.** The CSP is limited to `frame-ancestors`, `object-src`, `base-uri` and `form-action`. A `script-src` with per-request nonces comes in Phase 2 with real pages.
- **Addresses** store `lat_micro` and `lng_micro` (degrees times one million), never floats. `legal.policyVersion` was added to config and is stored on every consent.
- **First owner.** `db:seed` creates it from `INITIAL_OWNER_EMAIL` and `INITIAL_OWNER_PASSWORD` when no user has that email. Remove both variables after the first run.
- **Modules and providers** are covered in `docs/modules.md`. Providers ship as interfaces with working fakes; Paystack, Chowdeck, S3 and an SMS or WhatsApp adapter are not written yet and fail at startup with a clear message if selected.
- **Boot validation.** `src/instrumentation.ts` runs `validateBoot()`: the environment parses, the config parsed when imported, and the enabled modules resolve.

## 21. Phase 2 implementation notes

What the customer side added, and where it differs from the text above. Rulings are listed in `docs/phase-2-build-log.md`.

- **Pricing** is pure code in `src/domain/pricing/price-cart.ts`. The browser's cart holds item ids, modifier ids and quantities, never prices. Service charge applies to the subtotal and tax to subtotal plus service charge; with `pricesIncludeCharges` the same charges are extracted from the price instead.
- **Checkout** is `createPickupOrder()` (`src/db/orders.ts`): one transaction that validates the pickup slot (`src/domain/pickup/slots.ts`), prices from the database, and writes the order, line snapshots and contact row. A `checkout_token` makes a double submit return the same order, and `expectedTotalMinor` refuses an order whose total is no longer the one the customer saw.
- **Payment** is `startPayment()` then the webhook. `settlePayment()` (`src/payments/apply-payment.ts`) is the only code that moves `placed` to `paid`: it asks the provider to verify, compares amount and currency, and applies the change inside the same transaction as the stored event. Money that cannot be applied is kept and flagged in `audit_log`.
- **Webhook route** is `/api/webhooks/payment`, not a path per vendor, because business logic does not know the vendor. A bad signature is 401, an unreadable body 400, and a processing failure 500 so the provider retries.
- **Worker** (`pnpm worker`) runs `expireUnpaidOrders()` every minute. It asks the provider about each open payment before cancelling, so a missed webhook never cancels a paid order. pg-boss replaces the interval loop in Phase 4.
- **Tracking** polls `GET /api/orders/[code]` every 4 seconds while the tab is visible. The NOTIFY trigger and SSE stream arrive with the kitchen display in Phase 3.
- **Accounts**: sign-up with unticked consent boxes, sign-in, profile, marketing consent, JSON export (`/api/me/export`) and deletion. Deletion needs `orders.profile_id` to be nullable with `ON DELETE SET NULL` (migration 0007), anonymises the customer's orders, and blanks the provider payloads stored for their payments.
- **Cache Components**: every screen that reads the session or the database sits behind `<Suspense>`, and time-dependent screens call `connection()` first.
- **Branding**: `config.colors.primary` must be written as `oklch()` and dark enough for white text (contrast at least 4.5:1); the config check refuses anything else.
- **Turnstile**: `verifyTurnstile()` runs in the sign-up, sign-in and checkout actions when `TURNSTILE_SECRET_KEY` is set.
- **Password reset** (added after Phase 2): `EmailProvider` with a logging fake, Better Auth's reset flow with a one-hour single-use link that signs the account out everywhere, and `/forgot-password` and `/reset-password`. The answer to a reset request is identical whether or not the address has an account.

## 22. Phase 3 implementation notes

Details and rulings are in `docs/phase-3-build-log.md`.

- **Areas.** `(customer)`, `(admin)/admin` and `(kitchen)/kitchen` are route groups with their own shells. `requireStaff(roles, here)` redirects; the database enforces access.
- **What staff may do next** comes from `nextActions(role, status, fulfilment)` in `src/domain/orders/actions.ts`, derived from `TRANSITIONS`, so a screen cannot offer what the database refuses. Every action sends the status the screen showed (`expectedFrom`), so a stale screen gets a clear message instead of acting on a newer order.
- **Audit.** Management actions (cancel, complete, refund, menu and staff changes, resolving alerts) write `audit_log` in the same transaction as the change.
- **Alerts** are rows in the `alerts` table (migration 0009), raised by the system, read and resolved by managers and owners. Phase 4 reuses it for delivery failures and a low delivery wallet.
- **Refunds** (`src/payments/refund.ts`): reserve a refund row (unique per payment), ask the provider, then mark the payment refunded and move the order to `refunded`. A refused refund raises an alert and can be retried.
- **Realtime.** A trigger on `order_events` calls `pg_notify('order_events', ...)` (migration 0013). `listenTo()` in `src/db/context.ts` holds one session per web process, `StreamHub` fans messages out, `/api/stream/orders` streams them to signed-in staff with a 25 second heartbeat, and the kitchen board refetches `/api/staff/kitchen` on each message and every 10 seconds.
- **Menu pictures** are stored through `StorageProvider` under random keys (`menu/<uuid>.<ext>`), checked by content (JPEG, PNG, WebP, up to 2 MB), and served by `/api/media/[...key]`, which accepts only keys of that shape.
