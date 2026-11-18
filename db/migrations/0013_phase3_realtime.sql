-- Tells listening web processes that an order changed. NOTIFY is transactional (nothing is sent if the
-- change rolls back) but not durable, so screens also poll as a fallback (docs/ARCHITECTURE.md section 12).
-- The message is small on purpose: which order and its new status. Screens refetch what they show.
CREATE FUNCTION notify_order_event() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify('order_events', json_build_object('order_id', NEW.order_id, 'to', NEW.to_status)::text);
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER order_events_notify AFTER INSERT ON order_events
  FOR EACH ROW EXECUTE FUNCTION notify_order_event();
