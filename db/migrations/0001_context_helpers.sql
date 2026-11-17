-- Request identity helpers. src/db/context.ts sets app.user_id and app.role per transaction.
-- Unset or empty means NULL, so any policy that compares against them denies by default.
CREATE FUNCTION current_app_user() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE FUNCTION current_app_role() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.role', true), '') $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION current_app_user(), current_app_role() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION current_app_user(), current_app_role() TO app, system, migrator;
