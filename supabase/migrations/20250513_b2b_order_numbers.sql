-- Our order number already exists as custom_number
-- Add client's order number reference
ALTER TABLE b2b_orders ADD COLUMN IF NOT EXISTS client_order_number text;

CREATE INDEX IF NOT EXISTS b2b_orders_client_order_number_idx
  ON b2b_orders (client_order_number)
  WHERE client_order_number IS NOT NULL;
