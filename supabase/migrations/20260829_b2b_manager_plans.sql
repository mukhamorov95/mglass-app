-- А18: месячный план менеджера по B2B.
--
-- Планы cashflow_month_plans — про юниты ип/ооо и финнеделю, к менеджеру отношения
-- не имеют. Здесь план конкретного человека на месяц по запуску B2B-заказов.
-- Факт не храним: он всегда считается из b2b_orders (единственный источник правды).

CREATE TABLE IF NOT EXISTS public.b2b_manager_plans (
  id           bigserial PRIMARY KEY,
  manager_id   uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  month        text NOT NULL CHECK (month ~ '^\d{4}-\d{2}$'),
  plan_amount  numeric(14,2) NOT NULL DEFAULT 0 CHECK (plan_amount >= 0),
  note         text NOT NULL DEFAULT '',
  updated_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by_name text,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (manager_id, month)
);

CREATE INDEX IF NOT EXISTS b2b_manager_plans_month_idx ON public.b2b_manager_plans (month);

ALTER TABLE public.b2b_manager_plans ENABLE ROW LEVEL SECURITY;

-- Менеджер видит только свой план; владелец, коммерческий и финансы — все.
DROP POLICY IF EXISTS b2b_manager_plans_select ON public.b2b_manager_plans;
CREATE POLICY b2b_manager_plans_select ON public.b2b_manager_plans
  FOR SELECT TO authenticated
  USING (
    manager_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin','ceo','cfo','commercial'))
  );

-- План ставит владелец или коммерческий: сам себе менеджер план не рисует.
DROP POLICY IF EXISTS b2b_manager_plans_write ON public.b2b_manager_plans;
CREATE POLICY b2b_manager_plans_write ON public.b2b_manager_plans
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin','ceo','commercial')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin','ceo','commercial')));
