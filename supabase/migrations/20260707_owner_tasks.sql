-- Очередь задач владельца из Telegram-бота (голос/текст → AI-разбор → queued).
-- Клод забирает очередь при старте сессии (scripts/owner-tasks.mjs).
CREATE TABLE IF NOT EXISTS public.owner_tasks (
  id          bigserial PRIMARY KEY,
  raw_text    text NOT NULL,
  title       text NOT NULL,
  details     text,
  category    text NOT NULL DEFAULT 'other' CHECK (category IN ('production','sales','finance','marketing','it','other')),
  priority    text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
  source      text NOT NULL DEFAULT 'text' CHECK (source IN ('voice','text')),
  status      text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','in_progress','done','cancelled')),
  result_note text,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS owner_tasks_status_idx ON public.owner_tasks (status, created_at);

ALTER TABLE public.owner_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_tasks_owner ON public.owner_tasks;
CREATE POLICY owner_tasks_owner ON public.owner_tasks FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin','ceo')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin','ceo')));
