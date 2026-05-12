-- Add category column to glass_price_matrix to distinguish glass vs mirror
ALTER TABLE glass_price_matrix
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'glass';

-- Backfill any NULLs just in case
UPDATE glass_price_matrix SET category = 'glass' WHERE category IS NULL OR category = '';

-- Drop the old unique constraint (name, price_type)
ALTER TABLE glass_price_matrix
  DROP CONSTRAINT IF EXISTS glass_price_matrix_name_price_type_key;

-- Add new unique constraint including category
ALTER TABLE glass_price_matrix
  ADD CONSTRAINT glass_price_matrix_name_price_type_category_key
  UNIQUE (name, price_type, category);
