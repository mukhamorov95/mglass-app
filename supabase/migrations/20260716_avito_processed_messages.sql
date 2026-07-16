-- Идемпотентность вебхука Авито: каждое сообщение обрабатываем один раз
-- (Авито ретраит вебхук → без дедупа бот отвечал клиенту несколько раз).
-- Применено вручную через Supabase SQL Editor 16.07.2026 (с RLS enabled).
CREATE TABLE IF NOT EXISTS public.avito_processed_messages (
  msg_id     text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.avito_processed_messages ENABLE ROW LEVEL SECURITY;
