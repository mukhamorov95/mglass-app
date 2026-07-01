-- supabase/migrations/20260701_production_multistation_curved.sql
--
-- Рабочий может стоять на НЕСКОЛЬКИХ станциях (Бекмурза: резка+криволинейка,
-- Никита: закалка+упаковка). Плюс новый этап «криволинейка» (curved).
-- ✅ Безопасно: ADD COLUMN IF NOT EXISTS, backfill, пересоздание CHECK-констрейнтов.
-- ⚠️  Применять вручную через Supabase SQL Editor.

-- 1) users: одна станция → список станций
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS production_stations text[] NOT NULL DEFAULT '{}';

UPDATE public.users
  SET production_stations = ARRAY[production_station]
  WHERE production_station IS NOT NULL
    AND production_station <> ''
    AND (production_stations IS NULL OR production_stations = '{}');

COMMENT ON COLUMN public.users.production_stations IS
  'Станции цеха, на которых работает сотрудник (cutting|curved|polishing|drilling|tempering|packaging).
   Рабочему в «Мои задачи» падают задачи со всех его станций.';

-- 2) production_tasks: добавляем этап/станцию curved (криволинейная обработка кромки)
ALTER TABLE public.production_tasks DROP CONSTRAINT IF EXISTS pt_stage_key_valid;
ALTER TABLE public.production_tasks ADD CONSTRAINT pt_stage_key_valid CHECK (
  stage_key IN ('cutting','curved','polishing','drilling','tempering','packaging')
);
ALTER TABLE public.production_tasks DROP CONSTRAINT IF EXISTS pt_station_valid;
ALTER TABLE public.production_tasks ADD CONSTRAINT pt_station_valid CHECK (
  station IN ('cutting','curved','polishing','drilling','tempering','packaging')
);
