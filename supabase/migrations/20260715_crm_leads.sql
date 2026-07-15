-- Собственная CRM (контур MGlass): лиды/сделки воронки «Продажи» с теми же
-- этапами, что в AmoCRM (канон SYSTEM.md). Фаза 1: поток Авито + ручные лиды.
-- AmoCRM остаётся read-only архивом; активные сделки перенесём скриптом позже.

CREATE TABLE IF NOT EXISTS public.crm_leads (
  id             bigserial PRIMARY KEY,
  source         text NOT NULL DEFAULT 'manual'
                 CHECK (source IN ('avito','call','whatsapp','site','referral','manual')),
  name           text,
  phone          text,
  city           text,
  product        text,                 -- зеркало / душевая / лофт / стекло…
  sizes          text,                 -- «2000×800, 8мм» — как назвал клиент
  budget         text,                 -- бюджет-сигналы клиента словами
  est_amount     numeric,              -- предварительная цена (калькулятор/менеджер)
  est_profit     numeric,              -- ориентир прибыли (порог «берём от 15–20к» настраивается)
  stage          text NOT NULL DEFAULT 'Получена новая заявка',
  qualified      boolean NOT NULL DEFAULT false,   -- «Ключевой этап»: наш клиент, работаем
  score          int,                  -- 0–100 оценка перспективности (бот/РОП)
  score_reason   text,                 -- почему такой скоринг
  manager        text,                 -- ответственный менеджер (имя)
  avito_chat_id  text,                 -- связь с диалогом Авито (фаза бота)
  note           text,
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active','won','lost')),
  lost_reason    text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.crm_lead_events (
  id         bigserial PRIMARY KEY,
  lead_id    bigint NOT NULL REFERENCES public.crm_leads(id) ON DELETE CASCADE,
  kind       text NOT NULL DEFAULT 'note'
             CHECK (kind IN ('note','stage','call','message','quote','system')),
  text       text NOT NULL,
  author     text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_leads_stage_idx   ON public.crm_leads(stage);
CREATE INDEX IF NOT EXISTS crm_leads_status_idx  ON public.crm_leads(status);
CREATE INDEX IF NOT EXISTS crm_leads_manager_idx ON public.crm_leads(manager);
CREATE INDEX IF NOT EXISTS crm_events_lead_idx   ON public.crm_lead_events(lead_id);

ALTER TABLE public.crm_leads       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_lead_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crm_leads_all ON public.crm_leads;
CREATE POLICY crm_leads_all ON public.crm_leads FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS crm_events_all ON public.crm_lead_events;
CREATE POLICY crm_events_all ON public.crm_lead_events FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
