-- Baseline. The login roles (migrator, app, system) are created by scripts/db-bootstrap.ts.
-- The migrator owns the public schema; app and system may use it but never create objects in it.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO app, system;
