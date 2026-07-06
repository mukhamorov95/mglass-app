-- Новые станции/этапы: Фацет (facet) и Триплекс (triplex).
-- Порядок цепочки (физика стекла): вся обработка кромки/отверстий/фацета ДО закалки,
-- триплекс (склейка каленого) — ПОСЛЕ закалки, перед упаковкой.
-- ✅ Безопасно: только пересоздание CHECK-констрейнтов (существующие данные не трогаются).

ALTER TABLE public.production_tasks DROP CONSTRAINT IF EXISTS pt_stage_key_valid;
ALTER TABLE public.production_tasks ADD CONSTRAINT pt_stage_key_valid CHECK (
  stage_key IN ('cutting','curved','polishing','drilling','facet','tempering','triplex','packaging')
);

ALTER TABLE public.production_tasks DROP CONSTRAINT IF EXISTS pt_station_valid;
ALTER TABLE public.production_tasks ADD CONSTRAINT pt_station_valid CHECK (
  station IN ('cutting','curved','polishing','drilling','facet','tempering','triplex','packaging')
);
