-- b2b_material_sheet_variants: multiple sheet formats per material
CREATE TABLE IF NOT EXISTS b2b_material_sheet_variants (
  id                     serial PRIMARY KEY,
  material_id            int NOT NULL REFERENCES b2b_materials(id) ON DELETE CASCADE,
  sheet_width            int NOT NULL,
  sheet_height           int NOT NULL,
  supplier_id            uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_material_name text,
  is_default             boolean NOT NULL DEFAULT false,
  active                 boolean NOT NULL DEFAULT true,
  sort_order             int NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- Check constraint (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'b2b_material_sheet_variants_dims_check'
  ) THEN
    ALTER TABLE b2b_material_sheet_variants
    ADD CONSTRAINT b2b_material_sheet_variants_dims_check
    CHECK (sheet_width > 0 AND sheet_height > 0);
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS b2b_material_sheet_variants_material_id_idx
  ON b2b_material_sheet_variants (material_id);

CREATE INDEX IF NOT EXISTS b2b_material_sheet_variants_material_active_idx
  ON b2b_material_sheet_variants (material_id, active);

-- Only one active default per material
CREATE UNIQUE INDEX IF NOT EXISTS b2b_material_sheet_variants_one_default_idx
  ON b2b_material_sheet_variants (material_id)
  WHERE is_default = true AND active = true;

-- Backfill from existing b2b_materials data
INSERT INTO b2b_material_sheet_variants (
  material_id, sheet_width, sheet_height,
  supplier_id, supplier_material_name,
  is_default, active
)
SELECT
  id,
  COALESCE(sheet_width, 3210),
  COALESCE(sheet_height, 2250),
  supplier_id,
  supplier_material_name,
  true,
  true
FROM b2b_materials
WHERE NOT EXISTS (
  SELECT 1 FROM b2b_material_sheet_variants WHERE material_id = b2b_materials.id
);
