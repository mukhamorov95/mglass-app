ALTER TABLE materials                ADD COLUMN IF NOT EXISTS short_name TEXT;
ALTER TABLE services                 ADD COLUMN IF NOT EXISTS short_name TEXT;
ALTER TABLE hardware_items           ADD COLUMN IF NOT EXISTS short_name TEXT;
ALTER TABLE mirror_lighting_components ADD COLUMN IF NOT EXISTS short_name TEXT;
