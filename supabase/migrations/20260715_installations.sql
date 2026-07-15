-- Монтажи (ERP-блок отдела реализации): заявка на монтаж = один заказ = одна
-- задача бригаде. Фаза 1: формирование в одном окне + копия в чат + статусы.
-- Фаза 2: кабинет монтажника (заработок, свои монтажи). Фаза 3: выплаты.

CREATE TABLE IF NOT EXISTS public.installation_crews (
  id         bigserial PRIMARY KEY,
  name       text NOT NULL,             -- «Женя, Арген» / «Лёха» — как зовут в чате
  members    text,                      -- состав, если шире названия
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.installations (
  id             bigserial PRIMARY KEY,
  order_no       text NOT NULL,         -- «0715-2» — номер заказа MGlass
  title          text,                  -- изделие / что монтируем
  client_name    text,
  phone          text,
  address        text,
  entry_note     text,                  -- пропуск / как попасть на объект
  scheduled_date date,
  time_from      text,                  -- «11:00» — начало окна, в котором ждут
  time_to        text,                  -- «12:00»
  contact_before text,                  -- «за 30 минут» — когда связаться с клиентом
  crew_id        bigint REFERENCES public.installation_crews(id) ON DELETE SET NULL,
  amount         numeric,               -- сумма монтажа (бригаде)
  order_total    numeric,               -- общая сумма заказа (для маржи/аналитики)
  comment        text,
  status         text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','done','canceled')),
  closed_at      timestamptz,
  created_by     text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inst_date_idx   ON public.installations(scheduled_date);
CREATE INDEX IF NOT EXISTS inst_crew_idx   ON public.installations(crew_id);
CREATE INDEX IF NOT EXISTS inst_status_idx ON public.installations(status);

ALTER TABLE public.installation_crews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.installations      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS crews_all ON public.installation_crews;
CREATE POLICY crews_all ON public.installation_crews FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS inst_all ON public.installations;
CREATE POLICY inst_all ON public.installations FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
