-- Row-level security for every application table (docs/ARCHITECTURE.md section 11).
--
-- Identity comes from current_app_user() / current_app_role(), set per transaction by src/db/context.ts.
-- No context means NULL, so every policy below evaluates to false. The `app` database role serves
-- signed-in users, the `system` role serves webhooks, jobs and seeds. Neither has BYPASSRLS.
-- The table owner (`migrator`) is also bound by FORCE ROW LEVEL SECURITY and only gets policies
-- where a SECURITY DEFINER function or a migration needs them.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles', 'addresses', 'consents', 'data_requests',
    'menu_categories', 'menu_items', 'modifier_groups', 'modifiers',
    'orders', 'order_contacts', 'order_items', 'order_events', 'order_transitions',
    'payments', 'refunds', 'webhook_events', 'audit_log'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON %I FROM PUBLIC', t);
    EXECUTE format('CREATE POLICY system_all ON %I FOR ALL TO system USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- profiles: own row, or everyone for owner and manager. Role and blocked state change only through
-- the functions at the bottom of this file, never by direct UPDATE (column grants allow name and phone only).
CREATE POLICY profiles_select ON profiles FOR SELECT TO app
  USING (id = current_app_user() OR current_app_role() IN ('owner', 'manager'));
--> statement-breakpoint
CREATE POLICY profiles_update_self ON profiles FOR UPDATE TO app
  USING (id = current_app_user()) WITH CHECK (id = current_app_user());
--> statement-breakpoint
CREATE POLICY profiles_definer ON profiles FOR ALL TO migrator
  USING (current_setting('app.definer_ok', true) = '1') WITH CHECK (current_setting('app.definer_ok', true) = '1');
--> statement-breakpoint
GRANT SELECT ON profiles TO app;
--> statement-breakpoint
GRANT UPDATE (full_name, phone) ON profiles TO app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON profiles TO system;
--> statement-breakpoint

-- addresses: customers manage their own, owner and manager can read.
CREATE POLICY addresses_owner ON addresses FOR ALL TO app
  USING (current_app_role() = 'customer' AND profile_id = current_app_user())
  WITH CHECK (current_app_role() = 'customer' AND profile_id = current_app_user());
--> statement-breakpoint
CREATE POLICY addresses_staff_read ON addresses FOR SELECT TO app
  USING (current_app_role() IN ('owner', 'manager'));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON addresses TO app;
--> statement-breakpoint
GRANT SELECT, DELETE ON addresses TO system;
--> statement-breakpoint

-- consents: own rows (withdrawal only), owner and manager can read.
CREATE POLICY consents_select ON consents FOR SELECT TO app
  USING (profile_id = current_app_user() OR current_app_role() IN ('owner', 'manager'));
--> statement-breakpoint
CREATE POLICY consents_insert ON consents FOR INSERT TO app WITH CHECK (profile_id = current_app_user());
--> statement-breakpoint
CREATE POLICY consents_withdraw ON consents FOR UPDATE TO app
  USING (profile_id = current_app_user()) WITH CHECK (profile_id = current_app_user());
--> statement-breakpoint
GRANT SELECT, INSERT ON consents TO app;
--> statement-breakpoint
GRANT UPDATE (withdrawn_at) ON consents TO app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON consents TO system;
--> statement-breakpoint

-- data_requests: customers file and read their own, owner and manager read all.
CREATE POLICY data_requests_select ON data_requests FOR SELECT TO app
  USING (profile_id = current_app_user() OR current_app_role() IN ('owner', 'manager'));
--> statement-breakpoint
CREATE POLICY data_requests_insert ON data_requests FOR INSERT TO app
  WITH CHECK (profile_id = current_app_user() AND status = 'pending');
--> statement-breakpoint
GRANT SELECT, INSERT ON data_requests TO app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON data_requests TO system;
--> statement-breakpoint

-- menu: customers see active rows, staff see everything, owner and manager write.
CREATE POLICY menu_categories_select ON menu_categories FOR SELECT TO app
  USING (active OR current_app_role() IN ('kitchen', 'manager', 'owner'));
--> statement-breakpoint
CREATE POLICY menu_items_select ON menu_items FOR SELECT TO app
  USING (active OR current_app_role() IN ('kitchen', 'manager', 'owner'));
--> statement-breakpoint
CREATE POLICY modifier_groups_select ON modifier_groups FOR SELECT TO app USING (true);
--> statement-breakpoint
CREATE POLICY modifiers_select ON modifiers FOR SELECT TO app USING (true);
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['menu_categories', 'menu_items', 'modifier_groups', 'modifiers'] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL TO app USING (current_app_role() IN (''manager'', ''owner'')) WITH CHECK (current_app_role() IN (''manager'', ''owner''))',
      t || '_write', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO system', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- orders: own, active ones for the kitchen, everything for owner and manager.
-- Customers may create a `placed` order for themselves. Nobody in the app role can UPDATE an order:
-- status changes go through transition_order() (migration 0006).
CREATE POLICY orders_select ON orders FOR SELECT TO app USING (
  profile_id = current_app_user()
  OR current_app_role() IN ('owner', 'manager')
  OR (current_app_role() = 'kitchen' AND status IN ('paid', 'accepted', 'preparing', 'ready'))
);
--> statement-breakpoint
CREATE POLICY orders_insert ON orders FOR INSERT TO app
  WITH CHECK (current_app_role() = 'customer' AND profile_id = current_app_user() AND status = 'placed');
--> statement-breakpoint
GRANT SELECT, INSERT ON orders TO app;
--> statement-breakpoint
GRANT SELECT, UPDATE ON orders TO system;
--> statement-breakpoint

-- order_contacts: phone and address. Customer sees their own, owner and manager all, kitchen none.
CREATE POLICY order_contacts_select ON order_contacts FOR SELECT TO app USING (
  current_app_role() IN ('owner', 'manager')
  OR (current_app_role() = 'customer'
      AND EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND o.profile_id = current_app_user()))
);
--> statement-breakpoint
CREATE POLICY order_contacts_insert ON order_contacts FOR INSERT TO app WITH CHECK (
  current_app_role() = 'customer'
  AND EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND o.profile_id = current_app_user() AND o.status = 'placed')
);
--> statement-breakpoint
GRANT SELECT, INSERT ON order_contacts TO app;
--> statement-breakpoint
GRANT SELECT ON order_contacts TO system;
--> statement-breakpoint

-- order_items and order_events follow whichever orders the caller can already see.
CREATE POLICY order_items_select ON order_items FOR SELECT TO app
  USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id));
--> statement-breakpoint
CREATE POLICY order_items_insert ON order_items FOR INSERT TO app WITH CHECK (
  current_app_role() = 'customer'
  AND EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND o.profile_id = current_app_user() AND o.status = 'placed')
);
--> statement-breakpoint
CREATE POLICY order_events_select ON order_events FOR SELECT TO app
  USING (EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id));
--> statement-breakpoint
GRANT SELECT, INSERT ON order_items TO app;
--> statement-breakpoint
GRANT SELECT ON order_items TO system;
--> statement-breakpoint
GRANT SELECT ON order_events TO app;
--> statement-breakpoint
GRANT SELECT, INSERT ON order_events TO system;
--> statement-breakpoint

-- order_transitions: reference data. Everyone reads, only the migrator seeds it.
CREATE POLICY order_transitions_select ON order_transitions FOR SELECT TO app USING (true);
--> statement-breakpoint
CREATE POLICY order_transitions_migrator ON order_transitions FOR ALL TO migrator USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT ON order_transitions TO app, system;
--> statement-breakpoint

-- payments and refunds: customer sees their own, owner and manager all, kitchen none.
CREATE POLICY payments_select ON payments FOR SELECT TO app USING (
  current_app_role() IN ('owner', 'manager')
  OR (current_app_role() = 'customer'
      AND EXISTS (SELECT 1 FROM orders o WHERE o.id = order_id AND o.profile_id = current_app_user()))
);
--> statement-breakpoint
CREATE POLICY refunds_select ON refunds FOR SELECT TO app
  USING (EXISTS (SELECT 1 FROM payments p WHERE p.id = payment_id));
--> statement-breakpoint
CREATE POLICY refunds_insert ON refunds FOR INSERT TO app
  WITH CHECK (current_app_role() IN ('owner', 'manager') AND created_by = current_app_user());
--> statement-breakpoint
GRANT SELECT ON payments TO app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON payments TO system;
--> statement-breakpoint
GRANT SELECT, INSERT ON refunds TO app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON refunds TO system;
--> statement-breakpoint

-- webhook_events: the system role only. The app role has no policy and no grant.
GRANT SELECT, INSERT, UPDATE ON webhook_events TO system;
--> statement-breakpoint

-- audit_log: append-only. Staff add entries as themselves, only the owner reads.
CREATE POLICY audit_log_select ON audit_log FOR SELECT TO app USING (current_app_role() = 'owner');
--> statement-breakpoint
CREATE POLICY audit_log_insert ON audit_log FOR INSERT TO app WITH CHECK (
  actor_id = current_app_user()
  AND current_app_role() IN ('owner', 'manager', 'kitchen')
  AND actor_role = current_app_role()
);
--> statement-breakpoint
CREATE POLICY audit_log_definer ON audit_log FOR INSERT TO migrator WITH CHECK (current_setting('app.definer_ok', true) = '1');
--> statement-breakpoint
GRANT SELECT, INSERT ON audit_log TO app, system;
--> statement-breakpoint

-- Role and blocked state change only through these functions. They run as the migrator, which the
-- *_definer policies above admit only while app.definer_ok is set inside the function.
CREATE FUNCTION set_profile_role(p_target uuid, p_role app_role) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_app_role() IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'not allowed: only an owner can change roles' USING ERRCODE = '42501';
  END IF;
  IF p_target = current_app_user() THEN
    RAISE EXCEPTION 'not allowed: an owner cannot change their own role' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.definer_ok', '1', true);
  UPDATE profiles SET role = p_role WHERE id = p_target;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO audit_log (actor_id, actor_role, action, target_type, target_id, meta)
  VALUES (current_app_user(), 'owner', 'profile.role', 'profile', p_target::text, jsonb_build_object('role', p_role));
  PERFORM set_config('app.definer_ok', '', true);
END
$$;
--> statement-breakpoint
CREATE FUNCTION block_profile(p_target uuid, p_blocked boolean) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller text := current_app_role();
  v_target app_role;
BEGIN
  IF v_caller IS NULL OR v_caller NOT IN ('owner', 'manager') THEN
    RAISE EXCEPTION 'not allowed: only owners and managers can block accounts' USING ERRCODE = '42501';
  END IF;
  IF p_target = current_app_user() THEN
    RAISE EXCEPTION 'not allowed: you cannot block yourself' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.definer_ok', '1', true);
  SELECT role INTO v_target FROM profiles WHERE id = p_target;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'profile not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_caller = 'manager' AND v_target <> 'customer' THEN
    RAISE EXCEPTION 'not allowed: managers can only block customers' USING ERRCODE = '42501';
  END IF;
  UPDATE profiles SET blocked_at = CASE WHEN p_blocked THEN now() ELSE NULL END WHERE id = p_target;
  INSERT INTO audit_log (actor_id, actor_role, action, target_type, target_id)
  VALUES (current_app_user(), v_caller,
          CASE WHEN p_blocked THEN 'profile.block' ELSE 'profile.unblock' END, 'profile', p_target::text);
  PERFORM set_config('app.definer_ok', '', true);
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION set_profile_role(uuid, app_role), block_profile(uuid, boolean) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION set_profile_role(uuid, app_role), block_profile(uuid, boolean) TO app;
