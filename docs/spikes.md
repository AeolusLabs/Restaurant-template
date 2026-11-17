# Spike notes

Findings from the Phase 1 spikes. Each entry says what was proven and what is still unverified.

## Spike 1: PostgreSQL 18 (Task 4, 2026-11-17)

**Proven locally**
- The `embedded-postgres` npm package (18.6.0-beta.19) runs real PostgreSQL 18 binaries on Windows with no Docker. `select version()` reports `PostgreSQL 18`.
- `uuidv7()` is built in and returns version 7 UUIDs.
- Role bootstrap works: `migrator` owns the database and the `public` schema, `app` and `system` can connect and use the schema but cannot create objects. None has `SUPERUSER` or `BYPASSRLS`.
- Drizzle's migrator applies `db/migrations`, and a second run applies nothing.
- Tests run against a throwaway cluster started once per run (`tests/global-setup.ts`).

**Not verified (needs Railway)**
- The PostgreSQL 18 image tag on Railway and which plans include backups and point-in-time recovery. Railway's docs list 18 as supported but give no tag.
- Everything behind PgBouncer (see spike 2).

**Notes**
- Entry scripts are `.mts` because the package is CommonJS and the scripts use top-level await. Their logic lives in `scripts/lib/*.ts` so tests can import it.
- `embedded-postgres` is a development and test tool only. Production uses Railway's PostgreSQL.

## Spike 2: request context and deny-by-default RLS (Task 5, 2026-11-17)

**Proven locally (real PostgreSQL 18)**
- `withRequestContext()` opens a transaction, runs `set_config('app.user_id', ..., true)` and `set_config('app.role', ..., true)`, then the callback. `current_app_user()` and `current_app_role()` read them.
- No context: a policy keyed on `current_app_user()` returns zero rows. Verified with a plain connection as the `app` role.
- A user sees only their own rows, and a `WITH CHECK` stops a user inserting rows owned by someone else.
- The identity does not survive the transaction. With a pool of size 1 and 20 alternating users on the same connection, a raw query afterwards returns zero rows and both settings are empty.
- `FORCE ROW LEVEL SECURITY` makes the table owner (`migrator`) subject to the same policy.
- A throwing callback rolls everything back.
- A non-UUID `userId`, an unknown role (`admin`, `OWNER`, an injected string) and the `system` role are all rejected with `InvalidContextError` before any connection is opened.

**Not verified (needs Railway)**
- PgBouncer in transaction mode. `set_config(..., true)` is transaction-scoped, so it should be safe, but it has not been run through a real pooler. This is the first check after provisioning.

**Known limits**
- The identity is a plain session setting. Code that can run arbitrary SQL as the `app` role could call `set_config` itself. The defence is that application code never builds raw SQL from user input and only `src/db/context.ts` creates pools (enforced by a test in Task 14).
- A vitest teardown warning ("close timed out") appears intermittently. All tests pass. It comes from the embedded Postgres child process handles, not the application code.
