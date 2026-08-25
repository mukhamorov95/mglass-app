-- Версия прайса: замороженный снимок библиотеки, комплектов, ставок и финансовых
-- параметров на момент публикации. КП, выданное по версии, пересчитывается по ней же —
-- клиент не получит другую сумму после подорожания, а мы не продадим по старой цене.
-- Снимок самодостаточен (не ссылается на живые таблицы), чтобы КП годовой давности
-- воспроизводилось точно.
CREATE TABLE IF NOT EXISTS public.configurator_price_versions (
  id           bigserial PRIMARY KEY,
  label        text NOT NULL DEFAULT '',
  snapshot     jsonb NOT NULL,
  valid_days   integer NOT NULL DEFAULT 30,
  published_by text NOT NULL DEFAULT '',
  published_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cpv_published_idx ON public.configurator_price_versions (published_at DESC);
ALTER TABLE public.configurator_price_versions ENABLE ROW LEVEL SECURITY;
