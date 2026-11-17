-- alerts: raised by the system (webhooks, jobs), read and resolved by owners and managers.
-- Kitchen and customers have no policy, so they see nothing.
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE alerts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON alerts FROM PUBLIC;
--> statement-breakpoint
CREATE POLICY system_all ON alerts FOR ALL TO system USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY alerts_select ON alerts FOR SELECT TO app USING (current_app_role() IN ('owner', 'manager'));
--> statement-breakpoint
CREATE POLICY alerts_resolve ON alerts FOR UPDATE TO app
  USING (current_app_role() IN ('owner', 'manager'))
  WITH CHECK (current_app_role() IN ('owner', 'manager') AND resolved_by = current_app_user());
--> statement-breakpoint
GRANT SELECT ON alerts TO app;
--> statement-breakpoint
GRANT UPDATE (resolved_at, resolved_by) ON alerts TO app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON alerts TO system;
