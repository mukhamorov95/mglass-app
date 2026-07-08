-- Реферальный заработок: сотрудник (напр. Одилет на сверловке) приводит клиентов
-- и получает % от их оборота. Владелец добавляет клиентов реферера и вносит их
-- оборот по месяцам; сотрудник видит «Мой заработок» (за месяц + итого за год).

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS referral_rate_pct numeric;  -- ставка %, NULL = не реферер

CREATE TABLE IF NOT EXISTS public.referral_clients (
  id          bigserial PRIMARY KEY,
  referrer_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS referral_clients_referrer_idx ON public.referral_clients (referrer_id);

CREATE TABLE IF NOT EXISTS public.referral_turnover (
  id                 bigserial PRIMARY KEY,
  referral_client_id bigint NOT NULL REFERENCES public.referral_clients(id) ON DELETE CASCADE,
  ym                 date NOT NULL,             -- 1-е число месяца
  amount             numeric NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (referral_client_id, ym)
);
CREATE INDEX IF NOT EXISTS referral_turnover_client_idx ON public.referral_turnover (referral_client_id);

ALTER TABLE public.referral_clients  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_turnover ENABLE ROW LEVEL SECURITY;

-- Чтение доступно всем авторизованным (реферер видит свои строки, владелец — все).
-- Запись идёт только через owner-guarded API на сервис-роли (обходит RLS),
-- поэтому insert/update/delete политик для anon-ключа намеренно нет.
DROP POLICY IF EXISTS "auth_read_ref_clients" ON public.referral_clients;
CREATE POLICY "auth_read_ref_clients"  ON public.referral_clients  FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "auth_read_ref_turnover" ON public.referral_turnover;
CREATE POLICY "auth_read_ref_turnover" ON public.referral_turnover FOR SELECT USING (auth.uid() IS NOT NULL);
