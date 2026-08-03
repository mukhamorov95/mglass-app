-- Флажки квалификации заявок Авито (Фаза 1).
-- Аддитивно к crm_leads: дискретные флаги + детерминированная готовность и «светофор».
-- Источник правды по флагам и скорингу — lib/avito/flags.ts + lib/avito/scoreLead.ts.

ALTER TABLE public.crm_leads
  ADD COLUMN IF NOT EXISTS flags        jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {product:true, sizes:true, ...}
  ADD COLUMN IF NOT EXISTS readiness    int   NOT NULL DEFAULT 0,             -- 0..100 (из scoreLead)
  ADD COLUMN IF NOT EXISTS heat         text  NOT NULL DEFAULT 'cold',        -- cold | warm | hot
  ADD COLUMN IF NOT EXISTS missing_next text;                                 -- какой флаг бот добывает сейчас

-- Отдельным шагом, чтобы миграция была идемпотентной при повторном прогоне.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'crm_leads' AND constraint_name = 'crm_leads_heat_check'
  ) THEN
    ALTER TABLE public.crm_leads
      ADD CONSTRAINT crm_leads_heat_check CHECK (heat IN ('cold','warm','hot'));
  END IF;
END $$;

-- Доска фильтрует/сортирует горячие заявки — индекс по heat.
CREATE INDEX IF NOT EXISTS crm_leads_heat_idx ON public.crm_leads(heat);
