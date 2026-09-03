-- Кабинет менеджера, шаг 2: карточка Сделки (B2C).
--
-- Сделка живёт по ОБЪЕКТУ (адресу), а не по человеку: у одного клиента может быть
-- несколько сделок одновременно (душевая в квартире и зеркало на даче — два объекта,
-- два замера, два чертежа, два договора). Поэтому телефон отличает человека, адрес —
-- объект, и автосклейка только по телефону запрещена (делается в приложении/UI).
--
-- Тонкая группирующая сущность, НЕ копия b2b_orders: она собирает расчёты (и дальше
-- замер/чертёж/документы/деньги) по объекту. Статус НЕ хранится — производная от
-- содержимого (есть расчёт→КП→замер→счёт→оплата), чтобы не завести второе место правды.
-- amo_lead_id привязывает менеджер вручную; из Amo только читаем (номер/стадия/ответственный).

CREATE TABLE IF NOT EXISTS public.deals (
  id             bigserial PRIMARY KEY,
  client_name    text NOT NULL DEFAULT '',
  phone          text NOT NULL DEFAULT '',        -- как ввели
  phone_key      text,                            -- нормализованные последние 10 цифр (поиск/сопоставление)
  address        text NOT NULL DEFAULT '',        -- объект: то, что отличает сделку
  manager_id     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  amo_lead_id    text,                            -- ручная привязка к лиду Amo (read-only источник)
  created_by     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_by_name text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deals_phone_key_idx  ON public.deals (phone_key) WHERE phone_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS deals_manager_idx    ON public.deals (manager_id);
CREATE INDEX IF NOT EXISTS deals_created_by_idx ON public.deals (created_by);

-- Расчёт может висеть «осиротевшим» (deal_id NULL) — привязку делает человек.
ALTER TABLE public.calculations ADD COLUMN IF NOT EXISTS deal_id bigint REFERENCES public.deals(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS calculations_deal_id_idx ON public.calculations (deal_id) WHERE deal_id IS NOT NULL;

-- RLS: доступ к сделкам идёт через API сервис-клиентом с проверкой скоупа в коде
-- (как /api/invoices), политика ниже — защита в глубину. Менеджер видит свои сделки
-- (создал или назначен ответственным); владелец/коммерческий/финансы — все;
-- менеджер с can_view_all_clients — все. Пустой политики не оставляем (иначе PostgREST
-- отдаёт 200 с пустым телом без ошибки).
ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deals_select ON public.deals;
CREATE POLICY deals_select ON public.deals FOR SELECT TO authenticated USING (
  created_by = auth.uid() OR manager_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid()
             AND (u.role IN ('admin','ceo','commercial','cfo') OR u.can_view_all_clients = true))
);

DROP POLICY IF EXISTS deals_write ON public.deals;
CREATE POLICY deals_write ON public.deals FOR ALL TO authenticated USING (
  created_by = auth.uid() OR manager_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin','ceo','commercial'))
) WITH CHECK (
  created_by = auth.uid() OR manager_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin','ceo','commercial'))
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.deals TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.deals_id_seq TO authenticated;
