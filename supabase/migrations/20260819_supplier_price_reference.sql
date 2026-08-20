-- Общий справочник цен поставщиков (единый источник себестоимости).
-- Плоский: одна строка = товар одного цвета у одного поставщика. Категории/цвета —
-- свободный текст (форматы прайсов у поставщиков разные). Себестоимость = розница×(1−скидка).

CREATE TABLE IF NOT EXISTS public.supplier_price_sources (
  supplier         text PRIMARY KEY,           -- ключ поставщика: 'vetro', 'av24'
  title            text NOT NULL,              -- отображаемое имя: 'Ветро', 'АВ24'
  discount_percent numeric NOT NULL DEFAULT 0, -- наша скидка от цен поставщика
  currency         text NOT NULL DEFAULT 'RUB',
  site_url         text NOT NULL DEFAULT '',
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.supplier_price_rows (
  id               bigserial PRIMARY KEY,
  supplier         text NOT NULL,
  category         text NOT NULL DEFAULT '',
  article          text NOT NULL DEFAULT '',
  name             text NOT NULL,
  color            text NOT NULL DEFAULT '',
  unit             text NOT NULL DEFAULT 'шт',
  retail_price     numeric NOT NULL DEFAULT 0,   -- цена поставщика (розница/сайт)
  discount_percent numeric NOT NULL DEFAULT 0,   -- снимок скидки на момент импорта (переопределяемо)
  cost_price       numeric NOT NULL DEFAULT 0,   -- себестоимость = retail×(1−disc/100)
  url              text NOT NULL DEFAULT '',
  active           boolean NOT NULL DEFAULT true,
  source_file      text NOT NULL DEFAULT '',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (supplier, article, color)            -- идемпотентный upsert при повторной загрузке
);

CREATE INDEX IF NOT EXISTS spr_supplier_idx ON public.supplier_price_rows (supplier);
CREATE INDEX IF NOT EXISTS spr_category_idx ON public.supplier_price_rows (supplier, category);
CREATE INDEX IF NOT EXISTS spr_name_idx     ON public.supplier_price_rows USING gin (to_tsvector('simple', name || ' ' || article));

ALTER TABLE public.supplier_price_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supplier_price_rows    ENABLE ROW LEVEL SECURITY;

-- Чтение — любому авторизованному сотруднику; запись — только сервис-role (гейт в API по owner).
DROP POLICY IF EXISTS spr_read ON public.supplier_price_rows;
CREATE POLICY spr_read ON public.supplier_price_rows FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS sps_read ON public.supplier_price_sources;
CREATE POLICY sps_read ON public.supplier_price_sources FOR SELECT TO authenticated USING (true);

INSERT INTO public.supplier_price_sources (supplier, title, discount_percent, site_url) VALUES
  ('vetro', 'Ветро', 32, 'https://vetro-furniture.ru'),
  ('av24',  'АВ24',  25, 'https://av24.su')
ON CONFLICT (supplier) DO NOTHING;

-- Фасеты категорий для страницы справочника.
create or replace function public.supplier_price_categories(sup text)
returns table(category text, cnt bigint) language sql stable as $$
  select category, count(*)::bigint from public.supplier_price_rows
  where supplier = sup and active group by category order by category;
$$;
grant execute on function public.supplier_price_categories(text) to authenticated, service_role;

-- Массовый пересчёт себестоимости при смене скидки поставщика.
create or replace function public.supplier_price_reprice(sup text, disc numeric)
returns void language sql as $$
  update public.supplier_price_rows
  set discount_percent = disc,
      cost_price = round(retail_price * (1 - disc/100.0)),
      updated_at = now()
  where supplier = sup;
$$;
grant execute on function public.supplier_price_reprice(text, numeric) to service_role;
