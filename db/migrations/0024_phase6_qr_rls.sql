-- qr_sources: managers and owners write and read them. Customers and the kitchen see nothing; an order looks a
-- source up by slug with qr_source_for_slug(), which runs as the migrator and is admitted by the *_definer policy
-- only while the function has set app.definer_ok.
ALTER TABLE qr_sources ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE qr_sources FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON qr_sources FROM PUBLIC;
--> statement-breakpoint
CREATE POLICY system_all ON qr_sources FOR ALL TO system USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY qr_sources_staff ON qr_sources FOR ALL TO app
  USING (current_app_role() IN ('manager', 'owner')) WITH CHECK (current_app_role() IN ('manager', 'owner'));
--> statement-breakpoint
CREATE POLICY qr_sources_definer ON qr_sources FOR SELECT TO migrator USING (current_setting('app.definer_ok', true) = '1');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON qr_sources TO app;
--> statement-breakpoint
GRANT SELECT ON qr_sources TO system;
--> statement-breakpoint

-- qr_scans: only the system records them (the scan address is visited by people who are not signed in).
-- Managers and owners read them for the report.
ALTER TABLE qr_scans ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE qr_scans FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON qr_scans FROM PUBLIC;
--> statement-breakpoint
CREATE POLICY system_all ON qr_scans FOR ALL TO system USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY qr_scans_staff_select ON qr_scans FOR SELECT TO app USING (current_app_role() IN ('manager', 'owner'));
--> statement-breakpoint
GRANT SELECT ON qr_scans TO app;
--> statement-breakpoint
GRANT SELECT, INSERT ON qr_scans TO system;
--> statement-breakpoint

-- The id of an active source for a slug, or null. Used when an order is placed, to remember which code brought
-- the customer. It reveals nothing but that one id, and only to someone who already holds the slug.
CREATE FUNCTION qr_source_for_slug(p_slug text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_prev text := current_setting('app.definer_ok', true);
  v_id uuid;
BEGIN
  IF current_app_role() IS NULL THEN
    RAISE EXCEPTION 'not allowed: no identity in this transaction' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.definer_ok', '1', true);
  SELECT id INTO v_id FROM qr_sources WHERE slug = p_slug AND active;
  PERFORM set_config('app.definer_ok', coalesce(v_prev, ''), true);
  RETURN v_id;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION qr_source_for_slug(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION qr_source_for_slug(text) TO app, system;
