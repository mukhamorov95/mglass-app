-- supabase/migrations/20260701_b2b_materials_stock.sql
--
-- Остаток листов материала на складе (для сверки в раскрое: нужно / на складе / докупить).
-- ✅ Безопасно: ADD COLUMN IF NOT EXISTS, без изменения данных.
-- ⚠️  Применять вручную через Supabase SQL Editor.

ALTER TABLE public.b2b_materials
  ADD COLUMN IF NOT EXISTS stock_sheets numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.b2b_materials.stock_sheets IS
  'Остаток листов материала на складе. Ведётся владельцем в /admin/b2b-materials;
   раскрой сравнивает с потребностью (нужно листов) и показывает «докупить».';
