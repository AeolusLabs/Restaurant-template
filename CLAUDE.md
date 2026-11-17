# restaurant-template

A single-tenant restaurant ordering platform (customer site and admin site), built first for one real client and then reused as the base for future restaurant projects. It is **not** multi-tenant. Do not add `tenant_id`. Multi-tenancy is a possible future project, not this one.

Read `docs/ARCHITECTURE.md` for the design and `PRODUCT.md` for users, personality and design principles. This file holds the rules.

## Stack

Next.js (App Router) + TypeScript, Tailwind, Zod, Vitest, pnpm (Node 22 LTS). Railway: web service, worker service, PostgreSQL 18 with PgBouncer, S3-compatible bucket. Cloudflare in front. Better Auth and Drizzle (confirmed in Phase 1), pg-boss (Phase 2 onward). Paystack for payments, Chowdeck Relay for delivery.

## Hard rules

1. **Nothing client-specific in code.** Branding and business config (name, logo, colors, currency, timezone, address, opening hours, delivery zones, tax and service charge, feature flags) live in `config/restaurant.ts`. Secrets live only in `.env`; keep `.env.example` current.
2. **Data lives in the database.** Menu, promos, customers and orders are database rows. Ship a small seed menu so the app runs on first boot.
3. **Vendors sit behind interfaces.** `PaymentProvider` (Paystack), `DeliveryProvider` (Chowdeck), `NotificationProvider` (SMS and WhatsApp, stubbed), `LLMProvider`, `StorageProvider`. Business logic never imports a vendor SDK. Every interface has a mock for development and tests.
4. **Money is an integer in the minor unit** (kobo), column names end in `_minor`. Never floats, never decimal strings in the domain. Use `lib/money.ts`.
5. **One order state machine.** placed, paid, accepted, preparing, ready, then out_for_delivery or picked_up, then completed, plus cancelled, refunded and delivery_failed. Only `transitionOrder()` changes `orders.status`. Every transition is logged to `order_events`, and a database trigger rejects illegal ones.
6. **Webhooks verify signatures and are idempotent.** Read the raw body, verify with a constant-time comparison, insert into `webhook_events` under the unique constraint, and process only a new event.
7. **RBAC is enforced by Postgres RLS**, not only in the UI. Roles: owner, manager, kitchen, customer. All queries go through `withRequestContext()`.
8. **A new install is: migrate, seed, run.** Migrations and seed scripts live in the repo.
9. **Feature flags** in config: `promos`, `pickup`, `delivery`, `ai_agents`, `demo_mode`.
10. **NDPR and GDPR basics:** consent at signup, customer data export and deletion.
11. **`demo_mode`** enables `seed:demo` and a simulated live order stream, so the template can be deployed as a showcase with fictional data.
12. **A paid order whose delivery fails must be recoverable.** Move it to `delivery_failed`, raise an alert, and give admins retry and cancel actions. Alert on low Chowdeck wallet balance.

## Engineering rules

- **Apply schema changes, do not just write them.** When a migration adds, renames or removes a column or table, apply it to the real database in the same task. A purely additive migration needs no extra confirmation. If you cannot apply it, say the change is incomplete and blocked, and do not call the feature done.
- **One sanitizer plus a global safety net for sensitive fields.** Password hashes, tokens and secrets never reach a response. Use the shared serializers in `lib/sanitize.ts` (`toPublicUser()` and the others) at every call site, and keep the response-level key stripper in `lib/scrub.ts` active. Never hand-roll another destructure.
- **Never respond before an async session callback finishes.** If a handler calls anything that regenerates or saves a session, send the response inside that callback or await it.
- **Node.js runtime only.** Cache Components is enabled in `next.config.ts`, which makes Node the only runtime and forbids a `runtime` export. Never opt a route into the edge runtime.
- **The browser never sends prices.** The server prices every order from the database and config.
- **Redirect back from the payment page is not proof of payment.** Only a verified webhook (plus a provider verify call) moves an order to paid.
- **No vendor-specific hosting APIs in business logic.** The build stays host-agnostic.
- Validate every external input with Zod: config at boot, env at boot, request bodies, and provider responses.
- Keep `domain/` pure: no HTTP, no vendor SDKs, no direct database pool.

## Chowdeck Relay

Do not guess. The docs conflict on the base URL (`api.chowdeck.com` or `api.relay.chowdeck.com`), the webhook secret location, status vocabularies and several field requirements. `CHOWDECK_BASE_URL` has no default. The adapter maps every provider status to the internal `DeliveryStatus`, treats polling as the primary status source until webhooks are confirmed, and re-quotes at dispatch time because quotes expire. Flag any new ambiguity to the user instead of choosing silently. See `docs/ARCHITECTURE.md` section 10.

## How we work

- Work in phases (see `docs/ARCHITECTURE.md` section 18). **Stop after each phase and wait for approval.** Do not start the next phase early.
- Do not build out-of-scope items early: delivery integration (Phase 4), promos (5), QR codes (6), the BI dashboard (7), AI agents (8, 9), multi-tenancy (never). Feature flags exist for them, nothing more.
- Keep commits small and local, one per task. Never push, and never rewrite history, unless asked.
- Write tests for the state machine, money handling, promo calculation, webhook idempotency, and RLS (allowed and denied, per role).
- Prefer the smallest change that fully solves the task. No abstraction or option nobody asked for.
- Ask the user about anything blocking rather than inventing an answer. Do not invent metrics, counts or testimonials in the UI.

## Commands

First run: copy `.env.example` to `.env`, then in one terminal `pnpm db:local` (a real PostgreSQL 18 on port 55432, no Docker) and in another `pnpm setup && pnpm dev`.

```
pnpm db:local       start the local PostgreSQL 18 (keep it running)
pnpm setup          bootstrap roles, migrate, seed (idempotent, safe to re-run)
pnpm dev            the web app
pnpm db:bootstrap   create the migrator, app and system roles and the database
pnpm db:migrate     apply pending migrations
pnpm db:seed        seed the small menu, and the first owner if INITIAL_OWNER_* are set
pnpm auth:schema    regenerate src/db/schema/auth.ts from the Better Auth config
pnpm typecheck      next typegen, then tsc
pnpm test           Vitest (starts its own throwaway PostgreSQL 18)
```

Not built yet: the worker (Phase 2 onward) and `db:seed:demo` (Phase 9).

Migrations: tables come from `drizzle-kit generate`, everything else (RLS, functions, triggers) from `drizzle-kit generate --custom`. Apply every migration to the dev database in the same task.

Never point the dev scripts at a database you do not own. `bootstrapRoles` refuses anything that is not real PostgreSQL 18, and `db:local` refuses a port that is already in use.

## Design

Follow `PRODUCT.md`: register `product`, personality "quick, easy to use, trustworthy", fully responsive on every surface including the admin, WCAG 2.2 AA, and neutral by default so branding arrives through config tokens.
