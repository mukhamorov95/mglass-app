-- Add qty column to budget kit rows
ALTER TABLE shower_budget_kit_rows ADD COLUMN IF NOT EXISTS qty integer NOT NULL DEFAULT 1;

-- Manual price overrides per model + color
-- Used when positions aren't filled: admin can set kit price directly
CREATE TABLE IF NOT EXISTS shower_budget_manual_prices (
  id         serial PRIMARY KEY,
  model_id   text NOT NULL,
  color_id   integer NOT NULL REFERENCES shower_hw_colors(id) ON DELETE CASCADE,
  price      integer NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  UNIQUE (model_id, color_id)
);
