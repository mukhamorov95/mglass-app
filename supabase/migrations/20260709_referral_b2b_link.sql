-- Партнёрка v2: клиент реферера связывается с реальным B2B-клиентом.
-- Для привязанных клиентов оборот считается АВТОМАТИЧЕСКИ из b2b_orders
-- (помесячно), ручной ввод referral_turnover остаётся для непривязанных.

ALTER TABLE public.referral_clients
  ADD COLUMN IF NOT EXISTS b2b_client_id bigint REFERENCES public.b2b_clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS referral_clients_b2b_idx ON public.referral_clients (b2b_client_id);
