-- Agent tables. Managers and owners read everything. Owners change an agent's settings. Managers and owners
-- decide a pending proposal (approve it, or reject it). Only the system runs agents and executes proposals.
-- Customers and the kitchen have no policy, so they see nothing.

-- agent_configs
ALTER TABLE agent_configs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE agent_configs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON agent_configs FROM PUBLIC;
--> statement-breakpoint
CREATE POLICY system_all ON agent_configs FOR ALL TO system USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY agent_configs_select ON agent_configs FOR SELECT TO app USING (current_app_role() IN ('manager', 'owner'));
--> statement-breakpoint
CREATE POLICY agent_configs_owner_write ON agent_configs FOR INSERT TO app WITH CHECK (current_app_role() = 'owner');
--> statement-breakpoint
CREATE POLICY agent_configs_owner_update ON agent_configs FOR UPDATE TO app
  USING (current_app_role() = 'owner') WITH CHECK (current_app_role() = 'owner');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON agent_configs TO app;
--> statement-breakpoint

-- agent_runs: written only by the system.
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE agent_runs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON agent_runs FROM PUBLIC;
--> statement-breakpoint
CREATE POLICY system_all ON agent_runs FOR ALL TO system USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY agent_runs_select ON agent_runs FOR SELECT TO app USING (current_app_role() IN ('manager', 'owner'));
--> statement-breakpoint
GRANT SELECT ON agent_runs TO app;
--> statement-breakpoint

-- agent_proposals: a person can only move a pending proposal to approved (and only one made to wait for
-- approval, never plain advice) or to rejected, and only as themselves. Executing is the system's job.
ALTER TABLE agent_proposals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE agent_proposals FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON agent_proposals FROM PUBLIC;
--> statement-breakpoint
CREATE POLICY system_all ON agent_proposals FOR ALL TO system USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY agent_proposals_select ON agent_proposals FOR SELECT TO app USING (current_app_role() IN ('manager', 'owner'));
--> statement-breakpoint
CREATE POLICY agent_proposals_decide ON agent_proposals FOR UPDATE TO app
  USING (current_app_role() IN ('manager', 'owner') AND status = 'pending')
  WITH CHECK (
    current_app_role() IN ('manager', 'owner')
    AND decided_by = current_app_user()
    AND (status = 'rejected' OR (status = 'approved' AND mode = 'approve'))
  );
--> statement-breakpoint
GRANT SELECT ON agent_proposals TO app;
--> statement-breakpoint
GRANT UPDATE (status, decided_by, decided_at) ON agent_proposals TO app;
