-- Зеркалирование сделок AmoCRM в нашу CRM: связь по amo_lead_id (дедуп).
-- Применено вручную через Supabase SQL Editor 16.07.2026.
ALTER TABLE public.crm_leads ADD COLUMN IF NOT EXISTS amo_lead_id bigint;
CREATE UNIQUE INDEX IF NOT EXISTS crm_leads_amo_lead_id_uidx
  ON public.crm_leads(amo_lead_id) WHERE amo_lead_id IS NOT NULL;
