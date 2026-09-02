-- Панель платных сервисов (ПРИМЕНЕНА 02.09.2026).
--
-- Кредиты OpenAI кончились, и это выяснилось только когда перестала работать
-- функция. Никто не знал ни что баланс на нуле, ни сколько сервисов подключено
-- и во что они обходятся. Сервис, о котором узнают в момент отказа, — сюрприз.
--
-- Стоимости и даты платежей вводит владелец: у большинства провайдеров биллинг
-- закрыт для API-ключа, автоматически их взять неоткуда.

CREATE TABLE IF NOT EXISTS public.paid_services (
  id            bigserial PRIMARY KEY,
  key           text NOT NULL UNIQUE,
  name          text NOT NULL,
  gives         text NOT NULL,
  breaks_if_off text,
  monthly_cost  numeric,
  currency      text NOT NULL DEFAULT 'RUB' CHECK (currency IN ('RUB','USD','EUR')),
  billing       text CHECK (billing IN ('subscription','prepaid','usage','free')),
  next_payment  date,
  balance_note  text,
  critical      boolean NOT NULL DEFAULT false,
  status        text NOT NULL DEFAULT 'unknown'
                CHECK (status IN ('ok','warn','down','unknown','off')),
  checked_at    timestamptz,
  notes         text,
  sort          int NOT NULL DEFAULT 100,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.paid_services ENABLE ROW LEVEL SECURITY;

-- Деньги компании видит владелец и финансы, больше никто.
DROP POLICY IF EXISTS paid_services_read ON public.paid_services;
CREATE POLICY paid_services_read ON public.paid_services FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u
                 WHERE u.id = (SELECT auth.uid()) AND u.role IN ('admin','ceo','cfo')));

DROP POLICY IF EXISTS paid_services_write ON public.paid_services;
CREATE POLICY paid_services_write ON public.paid_services FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.users u
                 WHERE u.id = (SELECT auth.uid()) AND u.role IN ('admin','ceo')));
