ALTER TABLE orders      ADD COLUMN IF NOT EXISTS custom_number text;
ALTER TABLE b2b_orders  ADD COLUMN IF NOT EXISTS custom_number text;

CREATE INDEX IF NOT EXISTS orders_custom_number_idx
  ON orders (custom_number) WHERE custom_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS b2b_orders_custom_number_idx
  ON b2b_orders (custom_number) WHERE custom_number IS NOT NULL;
