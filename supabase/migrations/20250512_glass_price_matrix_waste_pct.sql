-- Add waste_pct column to glass_price_matrix
-- This column stores the baseline waste % for a material, sourced from cost rows.
-- The B2B calculator reads this to auto-fill waste % when a material is selected.
ALTER TABLE glass_price_matrix
  ADD COLUMN IF NOT EXISTS waste_pct int;
