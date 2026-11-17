# Phase 1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A scaffolded Next.js project with validated config, a PostgreSQL 18 schema with RLS and the order state machine, Better Auth sign-up with consent, role-based access, shared sanitizers, a seed, and a runbook, all proven by tests against a real PostgreSQL 18.

**Architecture:** One Next.js app (`src/`) plus `config/`, `db/` and `scripts/`. Drizzle owns table DDL, and custom SQL migrations own roles, RLS, functions and triggers. Every database call goes through `withRequestContext()`, which sets `app.user_id` and `app.role` per transaction. Development and tests use real PostgreSQL 18 binaries from the `embedded-postgres` package, because Docker is not installed. Railway provisioning is deferred until the user supplies an account (Task 13).

**Tech Stack:** Next.js (16.x at plan time), TypeScript strict, Tailwind, Zod 4, Vitest, pnpm, Drizzle ORM 0.45 and drizzle-kit 0.31, Better Auth 1.7, `pg`, `embedded-postgres` 18.x.

**Spec:** `docs/ARCHITECTURE.md` (sections 2 to 7, 11, 14), `CLAUDE.md`, `PRODUCT.md`. Executors read both the spec and this plan.

## Global Constraints

- Node 22 LTS pinned in `.nvmrc` and `package.json` `engines` (`">=22"`; this machine runs Node 25, which is fine for development).
- pnpm is the package manager. If `corepack enable pnpm` needs admin rights, use `npm install -g pnpm`.
- Money is an integer in the minor unit. Database columns are `bigint` and end in `_minor`. No floats anywhere in `domain/` or the schema.
- IDs are UUIDs, using PostgreSQL 18 `uuidv7()` as the default.
- Every table: `ENABLE` and `FORCE ROW LEVEL SECURITY`. DB roles: `migrator` (owns tables), `app`, `system`. Neither `app` nor `system` has `BYPASSRLS`.
- Request context is set only by `set_config('app.user_id', ..., true)` and `set_config('app.role', ..., true)` inside a transaction. No context means every policy evaluates to false.
- The raw pool is imported only in `src/db/context.ts`, `scripts/`, and test helpers.
- `domain/` has no vendor SDK, no HTTP and no database pool.
- Order status changes only through `transitionOrder()`. Staff and customers have no `UPDATE` on `orders`.
- Every route handler that touches the database or auth sets `export const runtime = 'nodejs'`.
- Validate config and env with Zod at boot. Nothing client-specific outside `config/restaurant.ts`.
- Schema changes are applied to the development database in the same task that writes them.
- Commit once per task, locally. Never push.
- Out of scope for Phase 1: customer UI, admin UI, Paystack, Chowdeck, jobs and pg-boss, phone OTP, account deletion and export endpoints, promos, QR, agents.

## Review Focus

1. **Context spoofing.** A user ID that is not a UUID, a role outside the enum (`'admin'`, `'owner; drop table orders'`), and a connection reused by the next request must never carry a previous request's identity. Test in Task 5.
2. **Concurrent transitions.** Two staff pressing "accept" on the same order at once: exactly one succeeds, the other gets a clear error, and exactly one `order_events` row exists. Test in Task 9.
3. **Scrubber shapes.** Sensitive keys in other cases (`PasswordHash`, `password_hash`), nested in arrays and objects, with `null`, dates and numbers around them, and an `text/event-stream` response that must pass through untouched. Test in Task 10.
4. **Sign-up abuse.** Missing consent is rejected, a body that includes `role: "owner"` still creates a `customer`, the raw Better Auth sign-up route cannot create a profile-less user, and a blocked user's session is refused. Tests in Task 11.
5. **Re-runs.** Running `db:migrate` or `db:seed` twice changes nothing, and an invalid config (tax above 100 percent, unknown currency exponent) stops boot with a readable message. Tests in Tasks 2, 4 and 12.

---

### Task 1: Scaffold the project

**Files:**
- Create: `package.json`, `tsconfig.json`, `.nvmrc`, `.gitignore`, `.env.example`, `vitest.config.ts`, `next.config.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `tests/smoke.test.ts`
- Existing: `CLAUDE.md`, `PRODUCT.md`, `docs/` (do not overwrite)

**Interfaces:**
- Produces: scripts `dev`, `build`, `lint`, `typecheck`, `test` (`vitest run`); path alias `@/*` to `src/*`; `output: 'standalone'` in `next.config.ts`.

- [ ] **Step 1: Initialise git and the app**
  Run `git init` in the project folder. Scaffold with `pnpm create next-app@latest . --ts --tailwind --eslint --app --src-dir --use-pnpm --import-alias "@/*" --no-turbopack`. If it refuses because the folder is not empty, scaffold into a scratch folder and move the files in, keeping the existing `CLAUDE.md`, `PRODUCT.md` and `docs/`.
- [ ] **Step 2: Pin and configure**
  Add `.nvmrc` (`22`), `engines`, `packageManager`, `"typecheck": "tsc --noEmit"`, strict TypeScript, and `output: 'standalone'`. Add `.pgdata/`, `.env`, `.env.local`, `node_modules/`, `.next/` to `.gitignore`. Replace the starter page with a minimal placeholder that renders the text `restaurant-template`. Add dev dependencies `vitest@5`, `dotenv`.
- [ ] **Step 3: Write the smoke test**
  `tests/smoke.test.ts`: `test('toolchain runs', () => { expect(1 + 1).toBe(2) })`. Run `pnpm test` and expect PASS.
- [ ] **Step 4: Verify the toolchain**
  Run `pnpm typecheck`, `pnpm lint`, `pnpm build`. Expect all three to exit 0.
- [ ] **Step 5: Commit** `chore: scaffold Next.js project with Vitest and standalone output`

---

### Task 2: Config and env validation

**Files:**
- Create: `config/schema.ts`, `config/restaurant.ts`, `src/lib/env.ts`, `tests/config.test.ts`, `tests/env.test.ts`; update `.env.example`

**Interfaces:**
- Produces: `restaurantConfigSchema` (Zod), `type RestaurantConfig`, `restaurantConfig: RestaurantConfig` (parsed at import), `loadEnv(source?: Record<string, string | undefined>): Env`, `type Env`.
- Config fields per spec section 4: `name`, `logo`, `colors`, `contact`, `address`, `currency` (`{ code, exponent }`), `timezone`, `locale`, `openingHours`, `pickup`, `delivery`, `charges` (`serviceChargeBps`, `taxBps`, `pricesIncludeCharges`), `orders` (`unpaidExpiryMinutes`, `cancellationWindow`), `features` (`promos`, `pickup`, `delivery`, `ai_agents`, `demo_mode`), `agents`.
- Env fields per spec section 4, plus `INITIAL_OWNER_EMAIL` and `INITIAL_OWNER_PASSWORD` (both optional).

- [ ] **Step 1: Write the failing tests**
  `config.test.ts`: `accepts the default config`; `rejects taxBps above 10000`; `rejects negative serviceChargeBps`; `rejects a currency exponent outside 0 to 4`; `rejects an unknown IANA timezone`; `rejects opening hours where close is not after open`.
  `env.test.ts`: `rejects BETTER_AUTH_SECRET shorter than 32 characters`; `requires PAYSTACK_SECRET_KEY when PAYMENT_PROVIDER is paystack`; `does not require it when PAYMENT_PROVIDER is mock`; `defaults every provider selector to mock`.
- [ ] **Step 2: Run to confirm failure** `pnpm vitest run tests/config.test.ts tests/env.test.ts`. Expect FAIL (modules missing).
- [ ] **Step 3: Implement** `config/schema.ts`, `config/restaurant.ts` (placeholder values: name `Sample Kitchen`, NGN with exponent 2, `Africa/Lagos`, `en-NG`, all feature flags set sensibly with `demo_mode` false) and `src/lib/env.ts`. Errors must name the offending field.
- [ ] **Step 4: Run to confirm pass** same command. Expect PASS.
- [ ] **Step 5: Commit** `feat: validated restaurant config and env`

---

### Task 3: Money module

**Files:**
- Create: `src/lib/money.ts`, `tests/money.test.ts`

**Interfaces:**
- Produces: `assertMinor(n: number): void` (throws `RangeError` unless `Number.isSafeInteger(n)`), `applyBps(amountMinor: number, bps: number): number`, `extractInclusiveBps(grossMinor: number, bps: number): number`, `formatMoney(amountMinor: number, fmt: { currency: string; exponent: number; locale: string }): string`.
- `applyBps` rounds half up using integer arithmetic (use `BigInt` internally so large amounts do not overflow before the division).

- [ ] **Step 1: Write the failing tests** in `money.test.ts`:
  - `assertMinor rejects 10.5, NaN, Infinity and 2**53`
  - `applyBps(1005, 750) is 75` (75.375 rounds down)
  - `applyBps(1, 5000) is 1` (0.5 rounds up)
  - `applyBps(3, 3333) is 1`
  - `applyBps(0, 750) is 0`
  - `applyBps rejects a fractional amount`
  - `extractInclusiveBps(10750, 750) is 750`
  - `formatMoney(150000, NGN, 2, en-NG)` contains `₦` and `1,500.00`
  - `formatMoney with exponent 0 shows no decimals`
- [ ] **Step 2: Run to confirm failure** `pnpm vitest run tests/money.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement** the four functions in `src/lib/money.ts`. Every function calls `assertMinor` on its inputs first.
- [ ] **Step 4: Run to confirm pass.** Expect PASS.
- [ ] **Step 5: Commit** `feat: integer money helpers`

---

### Task 4: PostgreSQL 18, roles and the migration runner (spike 1)

**Files:**
- Create: `scripts/db-local.ts`, `scripts/db-bootstrap.ts`, `scripts/migrate.ts`, `drizzle.config.ts`, `db/migrations/` (empty with `.gitkeep`), `tests/global-setup.ts`, `tests/helpers/db.ts`, `tests/db-foundation.test.ts`, `docs/spikes.md`; modify `vitest.config.ts` (add `globalSetup`)
- Dependencies: `embedded-postgres`, `pg`, `drizzle-orm`, `drizzle-kit`, `tsx`

**Interfaces:**
- Produces:
  - `pnpm db:local` starts a development cluster on port 54329 (data in `.pgdata/`).
  - `bootstrapRoles(adminUrl: string, passwords: { migrator: string; app: string; system: string }): Promise<void>` in `scripts/db-bootstrap.ts` (creates the three login roles if missing, creates the database objects they need, grants `CONNECT`; idempotent).
  - `runMigrations(migratorUrl: string): Promise<{ applied: number }>` in `scripts/migrate.ts` (Drizzle migrator over `db/migrations`).
  - `startTestDb(): Promise<{ urls: { admin: string; migrator: string; app: string; system: string }; stop(): Promise<void> }>` in `tests/helpers/db.ts`, started once by `globalSetup` on its own port and temp directory, exposed to tests through Vitest's `provide`/`inject`.
  - Scripts `db:bootstrap`, `db:migrate`, `setup` (bootstrap, then migrate; seed is added in Task 12).

- [ ] **Step 1: Write the failing test** `tests/db-foundation.test.ts` using the injected URLs:
  - `server is PostgreSQL 18` (`select version()` starts with `PostgreSQL 18`)
  - `uuidv7() is available` (`select uuidv7()` returns a UUID whose version nibble is 7)
  - `migrator, app and system roles exist and none has BYPASSRLS or SUPERUSER`
  - `app role cannot create tables`
  - `running migrations twice applies nothing the second time` (`applied === 0`)
- [ ] **Step 2: Run to confirm failure** `pnpm vitest run tests/db-foundation.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement** the scripts, `drizzle.config.ts` (schema `src/db/schema/*`, out `db/migrations`) and the test helper. `embedded-postgres` runs on Windows without Docker. Generate role passwords from env in development (`.env.example` documents the variables); tests use fixed throwaway passwords.
- [ ] **Step 4: Run to confirm pass.** Expect PASS. Then run `pnpm db:local` in one terminal, and `pnpm setup` in another. Expect exit 0.
- [ ] **Step 5: Record the spike** in `docs/spikes.md`: PostgreSQL version reported, how it was provisioned, whether `uuidv7()` worked, and what remains unverified (the Railway image tag and plan coverage of backups).
- [ ] **Step 6: Commit** `feat: PostgreSQL 18 dev and test database, roles, migration runner`

---

### Task 5: Request context and the RLS proof (spike 2)

**Files:**
- Create: `src/db/context.ts`, `src/db/client.ts`, `db/migrations/0001_context_helpers.sql` (custom migration), `tests/rls-context.test.ts`

**Interfaces:**
- Consumes: Task 4's `startTestDb`, `runMigrations`.
- Produces:
  - `type AppRole = 'owner' | 'manager' | 'kitchen' | 'customer'`
  - `type RequestContext = { userId: string; role: AppRole }`
  - `withRequestContext<T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>, opts?: { url?: string }): Promise<T>` (the `app` connection, one transaction)
  - `withSystemContext<T>(fn: (tx: Tx) => Promise<T>, opts?: { url?: string }): Promise<T>` (the `system` connection, sets `app.role` to `'system'`)
  - SQL functions `current_app_user() returns uuid` and `current_app_role() returns text` (stable, `current_setting(..., true)`, return NULL when unset).
- `withRequestContext` validates before any SQL: `userId` must be a UUID, `role` must be in the enum, else throws `InvalidContextError`.
- The test creates a scratch table `ctx_probe (id uuid, owner uuid)` through the migrator, with `FORCE` RLS and a policy `owner = current_app_user()`, and drops it afterwards. It is not part of the product schema.

- [ ] **Step 1: Write the failing tests** in `rls-context.test.ts`:
  - `no context returns zero rows`
  - `a user sees only their own rows`
  - `a role the user does not hold is not honoured: current_app_role() equals the context role`
  - `rejects a userId that is not a UUID` and `rejects 'admin' and 'owner; drop table ctx_probe' as roles`, each throwing before any query
  - `context does not leak to the next request`: with a pool of size 1, run 20 alternating requests for two users, then a raw query without context returns zero rows
  - `the table owner is also subject to the policy` (FORCE works)
- [ ] **Step 2: Run to confirm failure.** Expect FAIL.
- [ ] **Step 3: Implement** `context.ts` (the only importer of `pg`'s `Pool` besides scripts and test helpers), `client.ts` (builds Drizzle over a pool from env), and migration `0001`. `set_config(..., true)` is used for both settings.
- [ ] **Step 4: Run to confirm pass.** Expect PASS.
- [ ] **Step 5: Record the spike** in `docs/spikes.md`. Note that PgBouncer transaction mode could not be tested locally and is the first check on Railway.
- [ ] **Step 6: Commit** `feat: request context with deny-by-default RLS helpers`

---

### Task 6: Better Auth foundation (spike 3)

**Files:**
- Create: `src/auth/auth.ts`, `src/db/schema/auth.ts` (generated), `src/app/api/auth/[...all]/route.ts`, `db/migrations/0002_auth.sql` (generated), `tests/auth-foundation.test.ts`
- Modify: `docs/spikes.md`

**Interfaces:**
- Consumes: env (`BETTER_AUTH_SECRET`, `APP_URL`), the `app` database connection.
- Produces: `auth` (a configured Better Auth instance: email and password enabled, Drizzle adapter, UUID ids if the library allows it). The app creates customers only through Task 11's `signUpCustomer`.

- [ ] **Step 1: Read the docs, not memory.** Check Better Auth's current docs for: the Drizzle adapter, UUID id generation, the CLI schema generation command, how to disable or wrap the public sign-up route, and the hook that runs after user creation. Write what you found in `docs/spikes.md` before coding.
- [ ] **Step 2: Write the failing tests** in `auth-foundation.test.ts`, calling `auth.api` directly:
  - `signUpEmail creates a user and stores a password hash, never the plain text` (read the `account` row through the migrator)
  - `a duplicate email is rejected`
  - `sign-in with the right password returns a session and with the wrong password does not`
- [ ] **Step 3: Run to confirm failure.** Expect FAIL.
- [ ] **Step 4: Generate and apply the auth tables.** Run the Better Auth CLI to produce `src/db/schema/auth.ts`, run `drizzle-kit generate`, apply with `pnpm db:migrate`. If ids cannot be UUIDs, use `text` ids for `user` and note the deviation in `docs/spikes.md` and in `docs/ARCHITECTURE.md` section 5.
- [ ] **Step 5: Mount the handler** at `src/app/api/auth/[...all]/route.ts` with `runtime = 'nodejs'`, and configure `auth` until the tests pass. Run `pnpm vitest run tests/auth-foundation.test.ts`. Expect PASS.
- [ ] **Step 6: Commit** `feat: Better Auth with Drizzle adapter and auth tables`

---

### Task 7: Application schema

**Files:**
- Create: `src/domain/orders/statuses.ts`, `src/db/schema/{profiles,menu,orders,money,ops}.ts`, `src/db/schema/index.ts`, generated migration `db/migrations/0003_app_schema.sql`, `tests/schema.test.ts`
- Modify: `docs/ARCHITECTURE.md` (record any deviation)

**Interfaces:**
- Produces: `ORDER_STATUSES` (placed, paid, accepted, preparing, ready, out_for_delivery, picked_up, completed, cancelled, refunded, delivery_failed), `type OrderStatus`, `FULFILMENTS`, `APP_ROLES`, `CONSENT_TYPES`; Drizzle tables per spec section 5 for Phase 1: `profiles`, `addresses`, `consents`, `data_requests`, `menu_categories`, `menu_items`, `modifier_groups`, `modifiers`, `orders`, `order_contacts`, `order_items`, `order_events`, `order_transitions`, `payments`, `refunds`, `webhook_events`, `audit_log`.
- `menu_categories` and `menu_items` each have a unique `slug` (the seed's natural key). Money columns are `bigint({ mode: 'number' })`. Enums are Postgres enums built from the constants.

- [ ] **Step 1: Write the failing tests** in `schema.test.ts`:
  - `every _minor column is bigint` (query `information_schema.columns`)
  - `no column in the public schema uses real, double precision or numeric`
  - `inserting two payments with the same reference fails`
  - `inserting two webhook_events with the same provider and event_id fails`
  - `order_status enum values equal ORDER_STATUSES in order`
  - `profiles.role defaults to customer`
  - `deleting an order cascades to its items and contacts but not to payments` (payments restrict deletion)
- [ ] **Step 2: Run to confirm failure.** Expect FAIL.
- [ ] **Step 3: Define the schema** and generate `0003` with `drizzle-kit generate`. Apply with `pnpm db:migrate`.
- [ ] **Step 4: Run to confirm pass,** then re-run `tests/auth-foundation.test.ts`. Expect PASS.
- [ ] **Step 5: Commit** `feat: application schema for identity, menu, orders and money`

---

### Task 8: RLS policies and grants

**Files:**
- Create: `db/migrations/0004_rls.sql` (custom migration), `tests/rls-matrix.test.ts`, `tests/helpers/fixtures.ts`

**Interfaces:**
- Consumes: Task 5's `withRequestContext`, `withSystemContext`; Task 7's tables.
- Produces: `FORCE ROW LEVEL SECURITY` on every table; policies per the spec section 11 table; grants to `app` and `system` limited to what the table needs; `fixtures.ts` exports `makeUser(role: AppRole): Promise<{ userId: string; ctx: RequestContext }>` and `makeOrder(profileId: string, status?: OrderStatus): Promise<{ orderId: string }>` (inserted through the migrator, for setup only).

- [ ] **Step 1: Write the failing matrix test.** `rls-matrix.test.ts` is table-driven from one constant `EXPECTED` that encodes the spec table: for each of customer, kitchen, manager, owner and each table, whether `select`, `insert`, `update` and `delete` are allowed on the user's own row, on someone else's row, and on a non-existent context. Named cases that must exist:
  - `customer sees only their own orders and contacts`
  - `kitchen sees active orders and items but zero order_contacts rows`
  - `manager can read everything operational but cannot change a role`
  - `only owner can change profiles.role and read audit_log`
  - `no app role can select webhook_events, and none can update orders.status`
  - `customer can insert an order only for themselves with status placed`
  - `system can insert webhook_events and payments`
- [ ] **Step 2: Run to confirm failure.** Expect FAIL.
- [ ] **Step 3: Write `0004_rls.sql`** with `ENABLE` and `FORCE` on every table, policies keyed on `current_app_user()` and `current_app_role()`, and explicit grants. Revoke everything from `PUBLIC` first.
- [ ] **Step 4: Run to confirm pass.** Expect PASS. Fix the policy, not the expectation, unless the spec table is wrong, in which case update the spec in the same commit.
- [ ] **Step 5: Commit** `feat: row-level security policies and grants`

---

### Task 9: Order state machine

**Files:**
- Create: `src/domain/orders/transitions.ts`, `db/migrations/0005_order_transitions.sql` (custom), `tests/order-transitions.test.ts`

**Interfaces:**
- Consumes: `ORDER_STATUSES`, `Fulfilment`, `AppRole`, `withRequestContext`, `withSystemContext`.
- Produces:
  - `type Actor = { type: 'customer'; id: string } | { type: 'staff'; id: string; role: 'owner' | 'manager' | 'kitchen' } | { type: 'system' }`
  - `type TransitionRule = { from: OrderStatus; to: OrderStatus; fulfilment?: Fulfilment; actors: readonly ('customer' | 'kitchen' | 'manager' | 'owner' | 'system')[] }`
  - `TRANSITIONS: readonly TransitionRule[]` (the matrix from spec section 7, exactly)
  - `canTransition(from: OrderStatus, to: OrderStatus, fulfilment: Fulfilment, actor: Actor): boolean`
  - `transitionOrder(input: { orderId: string; to: OrderStatus; actor: Actor; expectedFrom?: OrderStatus; reason?: string; meta?: Record<string, unknown> }): Promise<{ status: OrderStatus }>`
  - errors `IllegalTransitionError`, `OrderNotFoundError`, `ConcurrentTransitionError` (thrown when `expectedFrom` no longer matches)
  - SQL: table `order_transitions` seeded from the matrix, function `transition_order(...)` (`SECURITY DEFINER`, owned by `migrator`, locks the row with `FOR UPDATE`, checks the matrix and actor, handles `resume_state`, writes `order_events`), trigger `orders_enforce_transition` as a backstop. The function sets a transaction-local flag that an `UPDATE` policy requires. The `app` role has no `UPDATE` on `orders`, so the flag grants it nothing.

- [ ] **Step 1: Write the failing tests** in `order-transitions.test.ts`:
  - `every rule in TRANSITIONS succeeds for its allowed actor` (table-driven, with the right fulfilment)
  - `every other from-to pair among the 11 statuses is rejected`
  - `kitchen cannot cancel, and a customer can cancel only placed or paid`
  - `ready to picked_up is pickup only, and ready to out_for_delivery is delivery only`
  - `delivery_failed returns to the stored resume_state, or goes to cancelled`
  - `a direct UPDATE of orders.status by the migrator is rejected by the trigger when the pair is not in order_transitions`
  - `the app role gets a permission error on UPDATE orders`
  - `TRANSITIONS equals the rows seeded in order_transitions` (same set, compared both ways)
  - `each transition writes exactly one order_events row with from, to, actor type and actor id`
  - `two simultaneous accepts: one succeeds, the other throws, one event row exists`
  - `expectedFrom that no longer matches throws ConcurrentTransitionError and changes nothing`
- [ ] **Step 2: Run to confirm failure.** Expect FAIL.
- [ ] **Step 3: Implement** the matrix and `transitionOrder` in TypeScript, and migration `0005`. `transitionOrder` calls the SQL function and maps its error codes (use distinct `SQLSTATE`s) to the three error classes.
- [ ] **Step 4: Run to confirm pass.** Expect PASS.
- [ ] **Step 5: Commit** `feat: enforced order state machine with database backstop`

---

### Task 10: Sanitizer and response scrubber

**Files:**
- Create: `src/lib/sanitize.ts`, `src/lib/scrub.ts`, `tests/sanitize.test.ts`, `tests/scrub.test.ts`

**Interfaces:**
- Produces:
  - `type PublicUser = { id: string; name: string; email: string; role: AppRole }`
  - `toPublicUser(row: unknown): PublicUser` (whitelist: picks only these fields, throws if `id` is missing)
  - `SENSITIVE_KEYS: readonly string[]` (compared after lower-casing and removing `_` and `-`): `password`, `passwordhash`, `hash`, `resettoken`, `verificationtoken`, `apikey`, `secret`, `clientsecret`
  - `scrubValue(value: unknown): unknown` (recursive, returns a new value, never mutates)
  - `withScrub(handler: (req: Request, ctx?: unknown) => Promise<Response>): (req: Request, ctx?: unknown) => Promise<Response>` (rewrites `application/json` bodies only)
- Better Auth's own routes are not wrapped, because their responses legitimately carry session data.

- [ ] **Step 1: Write the failing tests.**
  `sanitize.test.ts`: `toPublicUser returns only id, name, email and role`; `drops passwordHash, resetToken and any unknown field`; `throws when id is missing`.
  `scrub.test.ts`: `removes sensitive keys at any depth, including inside arrays`; `matches PasswordHash, password_hash and PASSWORD-HASH`; `keeps non-sensitive keys, null, numbers and dates unchanged`; `does not mutate its input`; `withScrub scrubs an application/json response and keeps its status and headers`; `withScrub returns a text/event-stream response untouched`; `withScrub returns a non-JSON body untouched`; `withScrub on invalid JSON returns the original response`.
- [ ] **Step 2: Run to confirm failure.** Expect FAIL.
- [ ] **Step 3: Implement** both modules. `withScrub` reads `response.clone()` so streams are never consumed.
- [ ] **Step 4: Run to confirm pass.** Expect PASS.
- [ ] **Step 5: Commit** `feat: shared public serializers and response scrubber`

---

### Task 11: Sign-up with consent, session helpers, RBAC and staff creation

**Files:**
- Create: `src/auth/signup.ts`, `src/auth/session.ts`, `src/auth/staff.ts`, `tests/signup.test.ts`, `tests/rbac.test.ts`

**Interfaces:**
- Consumes: `auth`, `withSystemContext`, `AppRole`, `RequestContext`.
- Produces:
  - `signUpCustomer(input: { email: string; password: string; name: string; consent: { terms: boolean; privacy: boolean; marketing?: boolean } }): Promise<{ userId: string }>` in `src/auth/signup.ts`, the only sign-up path the app uses. It writes the user, the `customer` profile and the consent rows (with the current policy version) in one transaction. The public Better Auth sign-up route is disabled or wrapped so it cannot bypass this.
  - `getRequestContext(headers: Headers): Promise<RequestContext | null>` (reads the Better Auth session, looks up `profiles.role` through the system context, returns `null` for no session, for a blocked profile, and for a deleted profile)
  - `requireRole(ctx: RequestContext | null, allowed: readonly AppRole[]): RequestContext` (throws `UnauthenticatedError` or `ForbiddenError`)
  - `createStaffUser(actor: RequestContext, input: { email: string; name: string; role: 'manager' | 'kitchen' | 'owner'; temporaryPassword: string }): Promise<{ userId: string }>` (owner only)
  - `blockCustomer(actor: RequestContext, profileId: string): Promise<void>` and `unblockCustomer(...)` (owner or manager), each writing an `audit_log` row

- [ ] **Step 1: Write the failing tests.**
  `signup.test.ts`:
  - `sign-up creates a customer profile and a consent row for terms and privacy, with the policy version`
  - `marketing consent is stored only when given`
  - `sign-up without terms or privacy consent is rejected and creates no user`
  - `a role field in the input is ignored and the profile role is customer`
  - `calling the public Better Auth sign-up route directly does not create a profile-less user`
  - `a failure after the user insert leaves no user behind` (transaction rolls back)
  `rbac.test.ts`:
  - `no session returns a null context`
  - `a blocked user's session returns a null context`
  - `a deleted profile's session returns a null context`
  - `requireRole throws UnauthenticatedError for null and ForbiddenError for the wrong role`
  - `only an owner can create staff; manager, kitchen and customer get ForbiddenError`
  - `a created staff member has the requested role and a hashed password`
  - `blocking a customer writes an audit_log row with the actor and the target`
  - `a manager cannot block an owner`
- [ ] **Step 2: Run to confirm failure.** Expect FAIL.
- [ ] **Step 3: Implement** the helpers. Do not respond from inside any session-regenerating call before it completes: await it.
- [ ] **Step 4: Run to confirm pass.** Expect PASS.
- [ ] **Step 5: Commit** `feat: session context, role checks and staff management`

---

### Task 12: Seed, setup command and first owner

**Files:**
- Create: `db/seed/menu.ts`, `db/seed/owner.ts`, `scripts/seed.ts`, `tests/seed.test.ts`; modify `package.json` (`db:seed`, `setup`), `.env.example`, `CLAUDE.md` (commands: web only until the worker exists in a later phase)

**Interfaces:**
- Produces: `seedMenu(): Promise<{ categories: number; items: number }>` (idempotent by `slug`; two categories, six items, one modifier group; prices positive integers), `seedOwner(): Promise<{ created: boolean }>` (creates the first owner from `INITIAL_OWNER_EMAIL` and `INITIAL_OWNER_PASSWORD`; does nothing if either is unset or an owner already exists), `pnpm setup` runs bootstrap, migrate, seed in order.

- [ ] **Step 1: Write the failing tests** in `seed.test.ts`:
  - `seedMenu twice leaves the same row counts`
  - `every seeded price is a positive integer`
  - `seedMenu changes the price of an existing slug back to the seed value but does not duplicate it`
  - `seedOwner creates exactly one owner and a second call creates none`
  - `seedOwner does nothing when the env variables are unset`
- [ ] **Step 2: Run to confirm failure.** Expect FAIL.
- [ ] **Step 3: Implement** the seeds and `scripts/seed.ts`. The seed runs through the system context.
- [ ] **Step 4: Run to confirm pass,** then on a clean data directory run `pnpm db:local` and `pnpm setup` twice. Expect exit 0 both times and no duplicate rows.
- [ ] **Step 5: Commit** `feat: idempotent seed menu, first owner, setup command`

---

### Task 13: Perimeter middleware, runbook and Railway readiness

**Files:**
- Create: `src/middleware.ts` (or the file name Next 16 documents for this role; check the installed Next docs), `tests/perimeter.test.ts`, `docs/runbook.md`, `Dockerfile`, `.dockerignore`
- Modify: `docs/spikes.md`

**Interfaces:**
- Produces: `checkOriginLock(headers: Headers, secret: string | undefined): boolean` (true when no secret is configured, or the header `x-origin-lock` equals it; constant-time comparison); security headers (CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, frame protection) applied to every response.

- [ ] **Step 1: Write the failing tests** in `perimeter.test.ts`: `allows any request when ORIGIN_LOCK_SECRET is unset`; `rejects a request without the header when the secret is set`; `rejects a wrong header`; `accepts the right header`; `responses carry the security headers`.
- [ ] **Step 2: Run to confirm failure.** Expect FAIL.
- [ ] **Step 3: Implement** the middleware and write `docs/runbook.md`: Railway project layout, role bootstrap, the env mapping from `.env.example`, turning on backups and PITR, a restore rehearsal checklist, secret rotation, the Cloudflare origin-lock Transform Rule and SSL mode, and the three items to verify on first deploy (PG 18 image tag, backup plan coverage, PgBouncer transaction mode with `withRequestContext`). Write a minimal multi-stage `Dockerfile` for the standalone build; note in `docs/spikes.md` that it is untested because Docker is not installed here.
- [ ] **Step 4: Run to confirm pass.** Expect PASS.
- [ ] **Step 5: Phase verification.** From a clean `.pgdata`: `pnpm db:local`, then `pnpm setup`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`. Start `pnpm dev`, and sign up through `POST /api/auth/sign-up/email` with consent using `curl` (exact body per the Task 6 spike notes). Expect each command to exit 0 and the sign-up to return a user with no password field.
- [ ] **Step 6: Provision on Railway (blocked until the user provides an account).** Create the project, a PostgreSQL 18 service and a bucket, run `db:bootstrap` and `db:migrate` against it, and check `select version()`. If this is not possible, say so in the Phase 1 report and leave the schema marked applied locally only.
- [ ] **Step 7: Commit** `feat: perimeter middleware, runbook and Dockerfile`

---

### Task 14: Provider interfaces, mocks and the provider registry

**Files:**
- Create: `src/providers/{payment,delivery,notification,llm,storage}/types.ts`, `src/providers/payment/mock.ts`, `src/providers/delivery/mock.ts`, `src/providers/notification/stub.ts`, `src/providers/llm/mock.ts`, `src/providers/storage/memory.ts`, `src/providers/registry.ts`, `src/providers/index.ts`, `tests/providers.test.ts`, `tests/architecture.test.ts`

**Interfaces:**
- Consumes: `Env` (provider selectors) from Task 2.
- Produces: the five interfaces exactly as in `docs/ARCHITECTURE.md` section 9 (`PaymentProvider`, `DeliveryProvider`, `NotificationProvider`, `LLMProvider`, `StorageProvider`) with their input and result types; `type ProviderKey = 'payment' | 'delivery' | 'notification' | 'llm' | 'storage'`; `type Providers`; `registerProvider<K extends ProviderKey>(key: K, name: string, factory: (env: Env) => Providers[K]): void`; `getProviders(env: Env): Providers`; `ProviderNotInstalledError`.
- Mocks are real working fakes for development and tests: payment (`simulatePayment(reference, status)`, webhooks signed and verified with a fixed test secret via `signMockWebhook(rawBody)`), delivery (`setWalletBalance`, `failNextCreate`, `advance(providerRef)`), notification (records messages in `sent`), LLM (returns a canned object that must pass the caller's Zod schema, with deterministic token usage), storage (in-memory map).
- A selector naming a real vendor (`paystack`, `chowdeck`, `s3`) with no registered adapter throws `ProviderNotInstalledError` that names the missing adapter file. Adding a vendor is one new file plus one `registerProvider` call.

- [ ] **Step 1: Write the failing tests.**
  `providers.test.ts`: `getProviders defaults every provider to its mock`; `selecting paystack with no adapter throws ProviderNotInstalledError naming the adapter`; `a provider registered at runtime is selected by name`; `mock payment verifies a webhook signed with signMockWebhook and rejects a tampered body`; `mock payment verify reflects simulatePayment`; `mock delivery quote then create returns a provider reference, and failNextCreate makes only the next create reject`; `mock delivery advance walks pending to awaiting_pickup to in_transit to delivered`; `mock delivery wallet balance is settable`; `notification stub records the message`; `mock llm output passes the caller's Zod schema and reports token usage`; `memory storage put then getStream round-trips bytes and returns null for a missing key`.
  `architecture.test.ts`: `no file under src/domain imports pg, next, drizzle, better-auth or a provider implementation`; `only src/db/context.ts and scripts import the pg Pool`.
- [ ] **Step 2: Run to confirm failure.** `pnpm vitest run tests/providers.test.ts tests/architecture.test.ts`. Expect FAIL.
- [ ] **Step 3: Implement** the types, mocks, registry and `getProviders`. Amounts are integer minor units everywhere.
- [ ] **Step 4: Run to confirm pass.** Expect PASS.
- [ ] **Step 5: Commit** `feat: provider interfaces, mocks and registry`

---

### Task 15: Module registry

**Files:**
- Create: `src/modules/types.ts`, `src/modules/registry.ts`, `src/modules/index.ts`, `src/modules/{pickup,delivery,promos,agents,demo}/module.ts`, `docs/modules.md`, `tests/modules.test.ts`

**Interfaces:**
- Consumes: `RestaurantConfig['features']` (Task 2), `ProviderKey` (Task 14).
- Produces:
  - `type AppModule = { id: string; description: string; feature?: keyof RestaurantConfig['features']; requiresProviders?: readonly ProviderKey[]; dependsOn?: readonly string[]; nav?: readonly { area: 'customer' | 'admin'; label: string; href: string; roles: readonly AppRole[] }[] }`
  - `defineModule(m: AppModule): AppModule`
  - `resolveModules(all: readonly AppModule[], features: RestaurantConfig['features']): readonly AppModule[]` (enabled modules, dependencies first; throws `ModuleConfigError` for a duplicate id, an unknown dependency, a dependency cycle, or an enabled module that depends on a disabled one)
  - `INSTALLED_MODULES: readonly AppModule[]` in `src/modules/index.ts`, and `getEnabledModules(): readonly AppModule[]`
- Core code never imports a module's folder directly. It asks the registry. Removing a feature is deleting its folder and one line in `index.ts`. The five shipped modules are manifests only (no UI), one per feature flag in config.

- [ ] **Step 1: Write the failing tests** in `modules.test.ts`:
  - `a module whose feature flag is off is excluded`
  - `a module with no feature flag is always included`
  - `dependencies are ordered before dependents`
  - `a duplicate id throws ModuleConfigError`
  - `an unknown dependency throws ModuleConfigError naming it`
  - `a dependency cycle throws ModuleConfigError`
  - `an enabled module that depends on a disabled one throws ModuleConfigError`
  - `removing a module from the list that another module depends on fails at resolve time, not at runtime`
  - `getEnabledModules follows restaurantConfig.features`
- [ ] **Step 2: Run to confirm failure.** Expect FAIL.
- [ ] **Step 3: Implement** the registry and the five manifests, and write `docs/modules.md`: how to add a module (folder, manifest, one line in `index.ts`, optional provider adapter), and how to remove one.
- [ ] **Step 4: Run to confirm pass.** Expect PASS.
- [ ] **Step 5: Commit** `feat: module registry with feature-flag driven modules`

---

## Self-Review Notes

- Spec coverage: scaffold (T1), config (T2), money (T3), PG 18 and migrations (T4), RLS context (T5), Better Auth foundation (T6), schema (T7), policies (T8), state machine (T9), sanitizer and scrubber (T10), consent sign-up, RBAC and staff (T11), seed and setup (T12), middleware, runbook and Railway (T13). Sections 12 to 13 (realtime, jobs, webhooks), 15 (agents) and the customer flows are later phases, per the spec's phase table.
- Spec changes made while planning: `order_contacts` added so RLS can exclude the kitchen; `slug` columns added for idempotent seeding. Both are recorded in `docs/ARCHITECTURE.md`.
- Names used across tasks: `withRequestContext`, `withSystemContext`, `RequestContext`, `AppRole`, `OrderStatus`, `ORDER_STATUSES`, `TRANSITIONS`, `transitionOrder`, `toPublicUser`, `scrubValue`, `withScrub`, `signUpCustomer`, `getRequestContext`, `requireRole`, `startTestDb`, `runMigrations`, `bootstrapRoles`.
