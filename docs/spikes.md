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
