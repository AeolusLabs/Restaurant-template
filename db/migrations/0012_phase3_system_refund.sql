-- The system may move a cancelled order to refunded, so a customer who cancels their own paid order is
-- refunded without a staff member. Mirrors src/domain/orders/transitions.ts (a test fails if they differ).
UPDATE order_transitions SET actors = ARRAY['system', 'manager', 'owner']
  WHERE from_status = 'cancelled' AND to_status = 'refunded' AND fulfilment_scope = 'any';
