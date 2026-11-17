# Phase 1 build log

Record of the decisions made while building Phase 1 (plan: `docs/superpowers/plans/2026-11-17-phase-1-foundation.md`). The build ran inline on branch `phase-1-foundation`, 15 tasks, test-first. Final state: 21 test files, 206 tests passing, typecheck, lint and build clean, and a fresh clone installs and passes from the lockfile.

## Scope change

Tasks 14 (provider interfaces, mocks and registry) and 15 (module registry) were added to the plan at the request for a modular skeleton that services plug into. Railway provisioning (Task 13, step 6) was skipped: no Railway account was supplied.

## Rulings

Each is a call made where the plan or spec was silent, wrong or ambiguous.

- Notification provider default is `stub`, not `mock`, matching ARCHITECTURE.md section 4.
- `tsconfig` target is ES2022 because the money math uses BigInt literals.
- Script logic lives in `scripts/lib/*.ts` with thin `.mts` entry points (the package is CommonJS and the scripts use top-level await).
- `AppRole` lives in `src/domain/roles.ts`; `src/db/client.ts` was not created because nothing needed it.
- No `export const runtime` anywhere: Next.js 16 with Cache Components forbids it, and Node is the only runtime. A test enforces this.
- `createAuth()` / `getAuth()` replace a module-level `auth`, so importing never needs a database. `scripts/auth-schema.config.ts` exists only for the schema generator.
- Better Auth tables have RLS enabled and forced, one policy for the `system` role, and no grant to `app`.
- Addresses store `lat_micro` / `lng_micro` integers, never floats.
- `order_transitions` uses a `fulfilment_scope` column (`any`, `pickup`, `delivery`) so it can be part of the primary key.
- Test fixtures connect as the superuser (exempt from RLS); policies are exercised only through the real request contexts.
- Active menu rows are readable with no identity, because visitors browse before signing in. Every other table returns nothing without a context, and a test asserts the one exception.
- Role and blocked state change only through `set_profile_role()` and `block_profile()`; column grants allow the app role to update only `full_name` and `phone`.
- SECURITY DEFINER functions run as the migrator, which FORCE RLS binds, so the tables they touch have a `TO migrator` policy gated on a transaction-local flag (`app.definer_ok`).
- The pure order matrix is in `src/domain/orders/transitions.ts`; `transitionOrder()` is in `src/db/transition-order.ts` so `domain/` has no database imports.
- The actor of a transition comes from the request context inside the database function, never from an argument.
- Custom SQLSTATEs `OT001` (illegal transition) and `OT002` (concurrent change) map to typed errors.
- The `order_transitions` seed SQL is generated from the TypeScript matrix (`scripts/gen-transitions-sql.ts`); a test fails if the two differ.
- `SENSITIVE_KEYS` also covers `token`, `accessToken`, `refreshToken` and `idToken`.
- `toPublicUser()` throws on a missing or unknown role instead of defaulting to customer.
- Public HTTP sign-up is refused by a Better Auth `hooks.before` rule; server-side sign-up still works. Both are tested.
- A failed profile or consent write removes the Better Auth user (compensation), because `auth.api` cannot join our transaction.
- `legal.policyVersion` was added to config and is stored on every consent.
- `seedOwnerFromEnv` skips when a user with `INITIAL_OWNER_EMAIL` exists, instead of "when any owner exists", which cannot be tested against a shared test database.
- `src/proxy.ts` is the Next.js 16 name for middleware. Its CSP is limited to directives that cannot break inline scripts; `script-src` with nonces comes in Phase 2.
- Extra architecture tests forbid vendor SDK imports outside `src/providers`, and were checked by planting real violations.
- Modules are manifests only; `requiresProviders` is metadata, not yet enforced at boot.
- `esbuild` is explicitly denied in `pnpm-workspace.yaml`, because pnpm 12 fails an install that leaves a build script undecided.

## Incident: collision with another project's database

While building Task 4, `pnpm db:local` reported success on port 54329. Another project on this machine, **Ecom AR with CRM**, was already running a PGlite (WebAssembly Postgres) server on `127.0.0.1:54329`. My embedded Postgres had bound only `[::1]`, so `pnpm setup` connected to the other project's server.

Changes my scripts made there:
- Created login roles `migrator`, `app` and `system`.
- Created a `restaurant` database entry owned by `migrator` and changed its CONNECT privileges.
- Ran `ALTER SCHEMA public OWNER TO migrator`.
- Applied migration 0000: `REVOKE ALL ON SCHEMA public FROM PUBLIC; GRANT USAGE ON SCHEMA public TO app, system`.
- Created schema `drizzle` with a `__drizzle_migrations` table holding one row (mine, dated 2026-11-17).

No data was read, changed or deleted, and the later migrations rolled back when they hit existing tables. PGlite treats every connection as a superuser, so that project is probably unaffected, but its schema ownership and privileges are no longer as they were. **Nothing was reverted**: the original owner and privileges are unknown and it is not this project's database.

Suggested cleanup, to be reviewed and run by the owner of that project (unverified):
```sql
DROP SCHEMA IF EXISTS drizzle CASCADE;                 -- created by this build, one row
ALTER SCHEMA public OWNER TO pg_database_owner;        -- or postgres; check a sibling database first
GRANT USAGE ON SCHEMA public TO PUBLIC;
ALTER DATABASE restaurant OWNER TO postgres;
GRANT CONNECT ON DATABASE restaurant TO PUBLIC;
REASSIGN OWNED BY migrator TO postgres;  DROP OWNED BY migrator, app, system;
DROP ROLE migrator, app, system;
```

Fixes here: the dev port is now 55432, `startCluster` refuses a port in use on IPv4 or IPv6 loopback, and `bootstrapRoles` refuses anything that is not real PostgreSQL 18 (never PGlite). Both are covered by `tests/cluster-safety.test.ts`.

## Not verified

- Anything on Railway: the PostgreSQL 18 image tag, backup and PITR plan coverage, PgBouncer transaction mode with the request context.
- The Docker build (Docker is not installed).
- Anything behind Cloudflare, and any real Paystack or Chowdeck call.

## Deferred minor findings

- A vitest teardown warning ("close timed out after 10000ms") appears intermittently; every test passes. It comes from the embedded Postgres child process handles. Fix by driving `pg_ctl` directly.
- A process crash between creating a Better Auth user and its profile leaves a profile-less user that blocks re-signup with the same email. It needs a cleanup job.
- `AppModule.requiresProviders` is not checked against the selected providers at boot.
- The CSP has no `script-src` until nonces land with real pages (Phase 2).
- A data migration that edits `profiles`, `orders`, `order_events` or `audit_log` must set `app.definer_ok` as the migrator.
- The generic key `token` in `SENSITIVE_KEYS` would also strip a legitimate field of that name from an own-API response.
- The request identity is a plain session setting. Code that can run arbitrary SQL as the `app` role could set it; architecture tests, not the database, prevent that.

## Windows note

Keep the project path short. The Postgres binary package creates symlinks during install; a deeply nested path made that fail silently in a test clone, and `initdb` then failed with a missing extension file. This project lives at `C:\Users\Leigh\Desktop\restaurant-template`, which is fine.

## Local machine problem: damaged pnpm store entry

On this machine the shared pnpm store has a damaged entry for `@embedded-postgres/windows-x64@18.6.0-beta.19`: after an install, its `dist/` folder (and `LICENSE.md`) can be missing, so `pnpm test` fails with `ERR_MODULE_NOT_FOUND ... windows-x64/dist/index.js`. The published package is fine: a clean store at a short path installs and passes all 206 tests. `pnpm install --force` did not repair the entry, and the restored folder disappeared once during cleanup work.

If it happens again, restore the folder from the published tarball, from the project root:
```
npm pack @embedded-postgres/windows-x64@18.6.0-beta.19
tar -xzf embedded-postgres-windows-x64-18.6.0-beta.19.tgz package/dist
```
then copy `package/dist` into `node_modules/.pnpm/@embedded-postgres+windows-x64@18.6.0-beta.19/node_modules/@embedded-postgres/windows-x64/`. A project-local store (`store-dir` in a `.npmrc`) avoids the shared store entirely. I did not run `pnpm store prune`, because the store is shared with your other projects.

## Flaky test fixed

`tests/seed.test.ts` counted every user in the shared test database, so it failed intermittently when another test file created users at the same moment. It now checks only its own email. Three consecutive full runs passed afterwards.

## Review

The final review was a self-review by the author, not a fresh reviewer. It found four Important issues, fixed test-first: `embedded-postgres` listed as a production dependency, a raw Zod dump as the config error, environment and config not validated at server start, and documentation drift. A fresh-clone check found a fifth, the failing `pnpm install`. A fresh review (`/code-review`) is recommended before merging.
