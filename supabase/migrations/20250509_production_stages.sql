-- Production stages progress per order (jsonb: stage_key -> completed_date or null)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS production_stages jsonb NOT NULL DEFAULT '{}';
