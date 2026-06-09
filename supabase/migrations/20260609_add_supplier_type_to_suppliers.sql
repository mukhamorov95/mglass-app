ALTER TABLE suppliers
ADD COLUMN IF NOT EXISTS supplier_type text NOT NULL DEFAULT 'other';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_supplier_type_check'
  ) THEN
    ALTER TABLE suppliers
    ADD CONSTRAINT suppliers_supplier_type_check
    CHECK (
      supplier_type IN (
        'glass_mirror',
        'hardware',
        'lighting',
        'consumables',
        'external_services',
        'logistics',
        'other'
      )
    );
  END IF;
END $$;

COMMENT ON COLUMN suppliers.supplier_type IS
'MVP classification for supplier filtering: glass_mirror, hardware, lighting, consumables, external_services, logistics, other';
