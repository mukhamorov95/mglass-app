-- Метаданные заявок с сайта (msk.mglass.pro) для SEO-аналитики.
-- Аддитивно к crm_leads: с какой посадочной страницы пришёл лид и какие UTM-метки.
-- Источник заявок — app/api/lead сайта (source='site'). Ничего не ломает: колонки
-- необязательные, дефолты пустые. Применять в Supabase SQL Editor (идемпотентно).

ALTER TABLE public.crm_leads
  ADD COLUMN IF NOT EXISTS landing_page text,                       -- '/zerkala/s-podsvetkoy' — что конвертит
  ADD COLUMN IF NOT EXISTS utm          jsonb NOT NULL DEFAULT '{}'::jsonb;  -- {source,medium,campaign,term,content,referrer}

-- Дашборд «SEO/Продвижение» группирует лиды по посадочной странице.
CREATE INDEX IF NOT EXISTS crm_leads_landing_page_idx ON public.crm_leads(landing_page);
CREATE INDEX IF NOT EXISTS crm_leads_source_idx       ON public.crm_leads(source);
