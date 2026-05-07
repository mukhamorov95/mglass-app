-- Add client tracking fields to calculations
ALTER TABLE calculations
  ADD COLUMN IF NOT EXISTS client_name  text,
  ADD COLUMN IF NOT EXISTS client_phone text;

CREATE INDEX IF NOT EXISTS idx_calculations_client_name  ON calculations(client_name);
CREATE INDEX IF NOT EXISTS idx_calculations_client_phone ON calculations(client_phone);
