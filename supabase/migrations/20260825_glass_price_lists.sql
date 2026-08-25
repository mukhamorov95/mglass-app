-- Прайсовая система B2B: версии прайсов поставщика стекла.
-- Слой лежит НАД справочником «Стекло»: версия прайса → маппинг → cost-ячейки
-- glass_price_matrix. Продажные цены и b2b_materials этот слой не трогает —
-- в b2b_materials по-прежнему пишет только /api/admin/sync-b2b-materials.

CREATE TABLE IF NOT EXISTS public.glass_price_lists (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier     text NOT NULL DEFAULT 'aig',        -- ключ поставщика прайса
  supplier_id  uuid,                                -- ссылка на suppliers (если заведён)
  title        text NOT NULL DEFAULT '',
  price_date   date NOT NULL,                       -- дата прайса «по состоянию на»
  currency     text NOT NULL DEFAULT 'RUB',
  vat_percent  numeric NOT NULL DEFAULT 22,         -- НДС, включённый в цены прайса
  file_path    text NOT NULL DEFAULT '',            -- b2b-attachments/supplier-price/glass/...
  file_name    text NOT NULL DEFAULT '',
  file_size    integer NOT NULL DEFAULT 0,
  file_mime    text NOT NULL DEFAULT '',
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','applied','archived')),
  notes        text NOT NULL DEFAULT '',
  parse_meta   jsonb NOT NULL DEFAULT '{}'::jsonb,  -- страницы, счётчики, версия парсера
  uploaded_by  uuid,
  uploaded_at  timestamptz NOT NULL DEFAULT now(),
  applied_by   uuid,
  applied_at   timestamptz
);

CREATE INDEX IF NOT EXISTS gpl_supplier_date_idx ON public.glass_price_lists (supplier, price_date DESC);

-- Снимок прайса: неизменяемые строки версии. Одна строка = цена за м² продукта на толщину.
CREATE TABLE IF NOT EXISTS public.glass_price_list_items (
  id            bigserial PRIMARY KEY,
  list_id       uuid NOT NULL REFERENCES public.glass_price_lists(id) ON DELETE CASCADE,
  section       text NOT NULL DEFAULT '',   -- Planiglass / Decomatt / Miroglass / Узорчатое ...
  product       text NOT NULL,              -- колонка прайса: Clear (M1), Grey, Crystalvision ...
  variant_code  text NOT NULL,              -- '4.00', '33.1' — как в прайсе
  thickness_mm  numeric,                    -- 4, 5, 6 … (null для триплекс-кодов)
  sheet_format  text NOT NULL DEFAULT '',   -- 3210x2250 и т.п., если указан в строке
  price_per_m2  numeric,                    -- null = «н/д» в прайсе
  note          text NOT NULL DEFAULT '',
  sort_order    integer NOT NULL DEFAULT 0,
  UNIQUE (list_id, section, product, variant_code)
);

CREATE INDEX IF NOT EXISTS gpli_list_idx ON public.glass_price_list_items (list_id, section, product);

-- Живая привязка: строка справочника ← колонка прайса. thickness=0 → правило на все толщины.
CREATE TABLE IF NOT EXISTS public.glass_price_mappings (
  id              bigserial PRIMARY KEY,
  supplier        text NOT NULL DEFAULT 'aig',
  matrix_name     text NOT NULL,
  matrix_category text NOT NULL CHECK (matrix_category IN ('glass','mirror')),
  thickness       integer NOT NULL DEFAULT 0,
  section         text NOT NULL DEFAULT '',
  product         text NOT NULL,
  coefficient     numeric NOT NULL DEFAULT 1,   -- доставка/резка/упаковка поверх цены прайса
  rounding        integer NOT NULL DEFAULT 1,   -- округление результата до N руб
  enabled         boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (supplier, matrix_name, matrix_category, thickness)
);

-- История применений: что именно записали в матрицу и из какой версии прайса.
CREATE TABLE IF NOT EXISTS public.glass_price_apply_log (
  id              bigserial PRIMARY KEY,
  list_id         uuid NOT NULL REFERENCES public.glass_price_lists(id) ON DELETE CASCADE,
  matrix_name     text NOT NULL,
  matrix_category text NOT NULL,
  thickness       integer NOT NULL,
  old_value       numeric,
  new_value       numeric,
  section         text NOT NULL DEFAULT '',
  product         text NOT NULL DEFAULT '',
  coefficient     numeric NOT NULL DEFAULT 1,
  applied_by      uuid,
  applied_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gpal_cell_idx ON public.glass_price_apply_log (matrix_name, matrix_category, thickness, applied_at DESC);
CREATE INDEX IF NOT EXISTS gpal_list_idx ON public.glass_price_apply_log (list_id);

ALTER TABLE public.glass_price_lists      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.glass_price_list_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.glass_price_mappings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.glass_price_apply_log  ENABLE ROW LEVEL SECURITY;

-- Чтение — авторизованным сотрудникам; запись — только service-role (гейт по роли в API).
DROP POLICY IF EXISTS gpl_read  ON public.glass_price_lists;
CREATE POLICY gpl_read  ON public.glass_price_lists      FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS gpli_read ON public.glass_price_list_items;
CREATE POLICY gpli_read ON public.glass_price_list_items FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS gpm_read  ON public.glass_price_mappings;
CREATE POLICY gpm_read  ON public.glass_price_mappings   FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS gpal_read ON public.glass_price_apply_log;
CREATE POLICY gpal_read ON public.glass_price_apply_log  FOR SELECT TO authenticated USING (true);
