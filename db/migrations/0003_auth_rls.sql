-- Better Auth owns these four tables and runs as the `system` database role.
-- The `app` role gets nothing: the application never reads or writes auth tables with a user context.
ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "user" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "session" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "session" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "account" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "account" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "verification" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "verification" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY auth_system ON "user" FOR ALL TO system USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY auth_system ON "session" FOR ALL TO system USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY auth_system ON "account" FOR ALL TO system USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY auth_system ON "verification" FOR ALL TO system USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "user", "session", "account", "verification" TO system;
