CREATE TABLE IF NOT EXISTS calculation_changes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calculation_id integer NOT NULL,
  field          text NOT NULL,
  old_value      text,
  new_value      text,
  reason         text,
  changed_by     text,
  created_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS calc_changes_calc_idx ON calculation_changes (calculation_id, created_at DESC);

-- Add client fields to calculations
ALTER TABLE calculations ADD COLUMN IF NOT EXISTS client_name  text;
ALTER TABLE calculations ADD COLUMN IF NOT EXISTS client_phone text;
ALTER TABLE calculations ADD COLUMN IF NOT EXISTS amo_lead_id  integer;
