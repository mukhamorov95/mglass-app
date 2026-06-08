-- extend purchase_orders for material requests (from /b2b-orders Material Requirement)
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS items         jsonb     DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS b2b_order_ids integer[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS expected_at   date,
  ADD COLUMN IF NOT EXISTS created_by    uuid      REFERENCES users(id) ON DELETE SET NULL;

COMMENT ON COLUMN purchase_orders.items         IS 'Material request lines generated from B2B material requirement estimate';
COMMENT ON COLUMN purchase_orders.b2b_order_ids IS 'Related B2B order ids for procurement visibility';
COMMENT ON COLUMN purchase_orders.expected_at   IS 'Expected material arrival or pickup date';
COMMENT ON COLUMN purchase_orders.created_by    IS 'User who created the purchase order';
