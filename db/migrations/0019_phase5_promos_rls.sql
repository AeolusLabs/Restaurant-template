-- promos: managers and owners write and read them. Customers never read this table; a code is looked up by
-- promo_for_code(), which runs as the migrator and is admitted by the *_definer policies only while the function
-- has set app.definer_ok. The kitchen has no policy, so it sees none.
ALTER TABLE promos ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE promos FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON promos FROM PUBLIC;
--> statement-breakpoint
CREATE POLICY system_all ON promos FOR ALL TO system USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY promos_staff ON promos FOR ALL TO app
  USING (current_app_role() IN ('manager', 'owner')) WITH CHECK (current_app_role() IN ('manager', 'owner'));
--> statement-breakpoint
CREATE POLICY promos_definer ON promos FOR SELECT TO migrator USING (current_setting('app.definer_ok', true) = '1');
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON promos TO app;
--> statement-breakpoint
GRANT SELECT ON promos TO system;
--> statement-breakpoint

-- promo_redemptions: a customer may record a use for their own order (and only their own); managers and owners
-- read them all. Releasing one when an order is cancelled unpaid is done by the trigger below.
ALTER TABLE promo_redemptions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE promo_redemptions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON promo_redemptions FROM PUBLIC;
--> statement-breakpoint
CREATE POLICY system_all ON promo_redemptions FOR ALL TO system USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY promo_redemptions_staff_select ON promo_redemptions FOR SELECT TO app
  USING (current_app_role() IN ('manager', 'owner'));
--> statement-breakpoint
CREATE POLICY promo_redemptions_insert ON promo_redemptions FOR INSERT TO app
  WITH CHECK (
    current_app_role() = 'customer'
    AND profile_id = current_app_user()
    AND EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND o.profile_id = current_app_user())
  );
--> statement-breakpoint
CREATE POLICY promo_redemptions_definer ON promo_redemptions FOR ALL TO migrator
  USING (current_setting('app.definer_ok', true) = '1') WITH CHECK (current_setting('app.definer_ok', true) = '1');
--> statement-breakpoint
GRANT SELECT, INSERT ON promo_redemptions TO app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON promo_redemptions TO system;
--> statement-breakpoint

-- Look a promo up by its code. Returns at most one row, and only to someone who already knows the code.
CREATE FUNCTION promo_for_code(p_code text) RETURNS SETOF promos
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_prev text := current_setting('app.definer_ok', true);
BEGIN
  IF current_app_role() IS NULL THEN
    RAISE EXCEPTION 'not allowed: no identity in this transaction' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.definer_ok', '1', true);
  RETURN QUERY SELECT * FROM promos WHERE code = upper(trim(p_code));
  PERFORM set_config('app.definer_ok', coalesce(v_prev, ''), true);
END
$$;
--> statement-breakpoint

-- How many times a promo is in use (released ones do not count), in total and by one customer.
CREATE FUNCTION promo_usage(p_promo uuid, p_profile uuid) RETURNS TABLE (total integer, mine integer)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_prev text := current_setting('app.definer_ok', true);
BEGIN
  IF current_app_role() IS NULL THEN
    RAISE EXCEPTION 'not allowed: no identity in this transaction' USING ERRCODE = '42501';
  END IF;
  IF current_app_role() = 'customer' AND p_profile IS DISTINCT FROM current_app_user() THEN
    RAISE EXCEPTION 'not allowed: a customer can only ask about their own use' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.definer_ok', '1', true);
  RETURN QUERY
    SELECT count(*)::integer, (count(*) FILTER (WHERE r.profile_id = p_profile))::integer
    FROM promo_redemptions r WHERE r.promo_id = p_promo AND r.released_at IS NULL;
  PERFORM set_config('app.definer_ok', coalesce(v_prev, ''), true);
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION promo_for_code(text), promo_usage(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION promo_for_code(text), promo_usage(uuid, uuid) TO app, system;
--> statement-breakpoint

-- An order cancelled while still unpaid (it expired, or the customer abandoned it) gives its promo use back.
-- It restores the caller's app.definer_ok afterwards, because transition_order sets it and still needs it.
CREATE FUNCTION release_promo_on_unpaid_cancel() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_prev text := current_setting('app.definer_ok', true);
BEGIN
  PERFORM set_config('app.definer_ok', '1', true);
  UPDATE promo_redemptions SET released_at = now() WHERE order_id = NEW.id AND released_at IS NULL;
  PERFORM set_config('app.definer_ok', coalesce(v_prev, ''), true);
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER orders_release_promo AFTER UPDATE OF status ON orders
  FOR EACH ROW WHEN (OLD.status = 'placed' AND NEW.status = 'cancelled')
  EXECUTE FUNCTION release_promo_on_unpaid_cancel();
