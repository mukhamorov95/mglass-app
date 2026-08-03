-- Обучение бота «Иван» на реальных ответах менеджеров (Фаза 3).
-- Корпус пар «ситуация клиента → как ответил живой менеджер». Наполняется
-- скриптом scripts/mine-manager-replies.mjs из crm_lead_events; вебхук подмешивает
-- релевантные примеры в промпт (few-shot). Источник логики — lib/avito/managerExamples.ts.

CREATE TABLE IF NOT EXISTS public.ai_manager_examples (
  id             bigserial PRIMARY KEY,
  lead_id        bigint,                  -- из какого лида взято (без FK — лид могут удалить)
  product        text,                    -- продукт лида (для подбора по теме)
  stage          text,                    -- этап на момент ответа (опционально)
  client_context text NOT NULL,           -- сообщение(я) клиента перед ответом
  manager_reply  text NOT NULL,           -- ответ живого менеджера (образец стиля)
  won            boolean NOT NULL DEFAULT false,  -- лид дошёл до продажи (сигнал качества)
  tags           text[] NOT NULL DEFAULT '{}',
  source         text NOT NULL DEFAULT 'mined'    -- mined | manual
                 CHECK (source IN ('mined','manual')),
  hash           text UNIQUE,             -- антидубль при повторном майнинге
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_manager_examples_product_idx ON public.ai_manager_examples(product);
CREATE INDEX IF NOT EXISTS ai_manager_examples_won_idx     ON public.ai_manager_examples(won);

-- Только service-role (вебхук/скрипт). Политик намеренно нет → анон-ключ доступа
-- не имеет, service_role работает через BYPASSRLS (паттерн rls_wave1_server_only).
ALTER TABLE public.ai_manager_examples ENABLE ROW LEVEL SECURITY;
