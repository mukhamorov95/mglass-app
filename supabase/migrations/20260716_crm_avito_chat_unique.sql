-- Уникальность чата Авито: гонка двух первых сообщений больше не плодит лиды-дубли
-- (иначе maybeSingle начинал падать и Иван отвечал «как на первое», теряя контекст).
-- Применено вручную через Supabase SQL Editor 16.07.2026.
CREATE UNIQUE INDEX IF NOT EXISTS crm_leads_avito_chat_id_uidx
  ON public.crm_leads(avito_chat_id) WHERE avito_chat_id IS NOT NULL;
