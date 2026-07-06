-- Платёжный календарь (ДДС): ручные плановые приходы и платежи.
-- Автоматические строки (дебиторка, постоянные из финмодели) считаются на лету
-- страницей /cfo/cashflow и в таблице не хранятся.
CREATE TABLE IF NOT EXISTS public.planned_payments (
  id          bigserial PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('in', 'out')),
  title       text NOT NULL,
  amount      numeric(14,2) NOT NULL,
  due_date    date NOT NULL,
  status      text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'done')),
  comment     text,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS planned_payments_due_idx ON public.planned_payments (due_date, status);

ALTER TABLE public.planned_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS planned_payments_owner ON public.planned_payments;
CREATE POLICY planned_payments_owner ON public.planned_payments FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin','ceo','cfo')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin','ceo','cfo')));
