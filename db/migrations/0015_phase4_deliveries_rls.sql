-- deliveries: the system books and updates them (worker, webhooks). Owners and managers read every one; a
-- customer reads only the delivery of their own order. The kitchen has no policy, so it sees none.
ALTER TABLE deliveries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE deliveries FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON deliveries FROM PUBLIC;
--> statement-breakpoint
CREATE POLICY system_all ON deliveries FOR ALL TO system USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY deliveries_select ON deliveries FOR SELECT TO app USING (
  current_app_role() IN ('owner', 'manager')
  OR (current_app_role() = 'customer'
      AND EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND o.profile_id = current_app_user()))
);
--> statement-breakpoint
GRANT SELECT ON deliveries TO app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON deliveries TO system;
--> statement-breakpoint

-- wallet_snapshots: written by the system's scheduled check, read by owners and managers.
ALTER TABLE wallet_snapshots ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE wallet_snapshots FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON wallet_snapshots FROM PUBLIC;
--> statement-breakpoint
CREATE POLICY system_all ON wallet_snapshots FOR ALL TO system USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY wallet_snapshots_select ON wallet_snapshots FOR SELECT TO app USING (current_app_role() IN ('owner', 'manager'));
--> statement-breakpoint
GRANT SELECT ON wallet_snapshots TO app;
--> statement-breakpoint
GRANT SELECT, INSERT ON wallet_snapshots TO system;
