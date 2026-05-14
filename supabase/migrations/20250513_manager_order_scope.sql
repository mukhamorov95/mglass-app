-- Track who created each b2b order
ALTER TABLE b2b_orders ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id);
CREATE INDEX IF NOT EXISTS b2b_orders_created_by_idx ON b2b_orders (created_by);

-- Allow admin to grant a manager visibility of all orders
ALTER TABLE users ADD COLUMN IF NOT EXISTS see_all_orders boolean NOT NULL DEFAULT false;
