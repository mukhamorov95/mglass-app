-- Финансовое планирование (модель Хаббарда): точки безубыточности ТБ-0/ТБ-1 по юнитам.
-- Одна строка на юнит (total | mglass | production), вся модель в jsonb —
-- структура повторяет таблицу владельца (доходы, переменные %, фонды от маржи, постоянные).
CREATE TABLE IF NOT EXISTS public.finplan_models (
  unit        text PRIMARY KEY CHECK (unit IN ('total','mglass','production')),
  data        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by  text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.finplan_models ENABLE ROW LEVEL SECURITY;
-- Финансовая модель — только владельцы/CFO.
DROP POLICY IF EXISTS finplan_owner ON public.finplan_models;
CREATE POLICY finplan_owner ON public.finplan_models FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin','ceo','cfo')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin','ceo','cfo')));
