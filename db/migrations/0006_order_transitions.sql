-- The enforced copy of the order state machine (the TypeScript copy is src/domain/orders/transitions.ts,
-- and tests/order-transitions.test.ts fails if the two differ). Regenerate the INSERT with
-- `pnpm exec tsx scripts/gen-transitions-sql.ts` whenever the matrix changes, in a new migration.

INSERT INTO order_transitions (from_status, to_status, fulfilment_scope, actors) VALUES
  ('placed', 'paid', 'any', ARRAY['system']),
  ('placed', 'cancelled', 'any', ARRAY['system', 'customer']),
  ('paid', 'accepted', 'any', ARRAY['kitchen', 'manager', 'owner']),
  ('paid', 'cancelled', 'any', ARRAY['customer', 'manager', 'owner']),
  ('accepted', 'preparing', 'any', ARRAY['kitchen', 'manager', 'owner']),
  ('accepted', 'cancelled', 'any', ARRAY['manager', 'owner']),
  ('preparing', 'ready', 'any', ARRAY['kitchen', 'manager', 'owner']),
  ('ready', 'out_for_delivery', 'delivery', ARRAY['system']),
  ('ready', 'picked_up', 'pickup', ARRAY['kitchen', 'manager', 'owner']),
  ('out_for_delivery', 'completed', 'delivery', ARRAY['system', 'manager', 'owner']),
  ('picked_up', 'completed', 'pickup', ARRAY['system', 'manager', 'owner']),
  ('accepted', 'delivery_failed', 'delivery', ARRAY['system']),
  ('preparing', 'delivery_failed', 'delivery', ARRAY['system']),
  ('ready', 'delivery_failed', 'delivery', ARRAY['system']),
  ('out_for_delivery', 'delivery_failed', 'delivery', ARRAY['system']),
  ('delivery_failed', 'accepted', 'any', ARRAY['manager', 'owner']),
  ('delivery_failed', 'preparing', 'any', ARRAY['manager', 'owner']),
  ('delivery_failed', 'ready', 'any', ARRAY['manager', 'owner']),
  ('delivery_failed', 'out_for_delivery', 'any', ARRAY['manager', 'owner']),
  ('delivery_failed', 'cancelled', 'any', ARRAY['manager', 'owner']),
  ('cancelled', 'refunded', 'any', ARRAY['manager', 'owner']),
  ('completed', 'refunded', 'any', ARRAY['manager', 'owner']);
--> statement-breakpoint

-- Backstop: any change to orders.status, from any role, must be a pair in order_transitions.
CREATE FUNCTION enforce_order_transition() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT EXISTS (
    SELECT 1 FROM order_transitions t
    WHERE t.from_status = OLD.status AND t.to_status = NEW.status
      AND t.fulfilment_scope IN ('any', NEW.fulfilment::text)
  ) THEN
    RAISE EXCEPTION 'illegal order transition: % -> %', OLD.status, NEW.status USING ERRCODE = 'OT001';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER orders_enforce_transition BEFORE UPDATE OF status ON orders
  FOR EACH ROW EXECUTE FUNCTION enforce_order_transition();
--> statement-breakpoint

-- transition_order() is the only way the app changes an order's status. It runs as the migrator, which
-- the policies below admit only while app.definer_ok is set inside the function. The caller's identity
-- (current_app_role / current_app_user) decides who the actor is, so it cannot be spoofed by an argument.
CREATE POLICY orders_definer ON orders FOR ALL TO migrator
  USING (current_setting('app.definer_ok', true) = '1') WITH CHECK (current_setting('app.definer_ok', true) = '1');
--> statement-breakpoint
CREATE POLICY order_events_definer ON order_events FOR INSERT TO migrator
  WITH CHECK (current_setting('app.definer_ok', true) = '1');
--> statement-breakpoint

CREATE FUNCTION transition_order(
  p_order_id uuid,
  p_to order_status,
  p_expected_from order_status DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_meta jsonb DEFAULT '{}'::jsonb
) RETURNS order_status
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_role text := current_app_role();
  v_order orders%ROWTYPE;
  v_actor actor_type;
BEGIN
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'not allowed: no identity in this transaction' USING ERRCODE = '42501';
  END IF;
  v_actor := CASE v_role WHEN 'system' THEN 'system' WHEN 'customer' THEN 'customer' ELSE 'staff' END;

  PERFORM set_config('app.definer_ok', '1', true);
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_role = 'customer' AND v_order.profile_id IS DISTINCT FROM current_app_user() THEN
    RAISE EXCEPTION 'not allowed: not your order' USING ERRCODE = '42501';
  END IF;
  IF p_expected_from IS NOT NULL AND v_order.status <> p_expected_from THEN
    RAISE EXCEPTION 'order is now %, expected %', v_order.status, p_expected_from USING ERRCODE = 'OT002';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM order_transitions t
    WHERE t.from_status = v_order.status AND t.to_status = p_to
      AND t.fulfilment_scope IN ('any', v_order.fulfilment::text)
      AND v_role = ANY (t.actors)
  ) THEN
    RAISE EXCEPTION 'illegal order transition for %: % -> %', v_role, v_order.status, p_to USING ERRCODE = 'OT001';
  END IF;
  IF v_order.status = 'delivery_failed' AND p_to <> 'cancelled' AND p_to IS DISTINCT FROM v_order.resume_state THEN
    RAISE EXCEPTION 'illegal order transition: a failed delivery resumes at %, not %', v_order.resume_state, p_to
      USING ERRCODE = 'OT001';
  END IF;

  UPDATE orders
     SET status = p_to,
         resume_state = CASE
           WHEN p_to = 'delivery_failed' THEN v_order.status
           WHEN v_order.status = 'delivery_failed' THEN NULL
           ELSE resume_state END,
         updated_at = now()
   WHERE id = p_order_id;

  INSERT INTO order_events (order_id, from_status, to_status, actor_type, actor_id, reason, meta)
  VALUES (p_order_id, v_order.status, p_to, v_actor, current_app_user(), p_reason, COALESCE(p_meta, '{}'::jsonb));

  PERFORM set_config('app.definer_ok', '', true);
  RETURN p_to;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION transition_order(uuid, order_status, order_status, text, jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION transition_order(uuid, order_status, order_status, text, jsonb) TO app, system;
