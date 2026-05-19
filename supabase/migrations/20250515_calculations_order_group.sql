ALTER TABLE calculations ADD COLUMN IF NOT EXISTS order_group_id UUID;
CREATE INDEX IF NOT EXISTS idx_calculations_order_group ON calculations(order_group_id) WHERE order_group_id IS NOT NULL;
