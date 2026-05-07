-- Link orders to delivery zones and brigades
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_zone_id uuid REFERENCES delivery_zones(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delivery_cost    numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS brigade_id       uuid REFERENCES brigades(id) ON DELETE SET NULL;
