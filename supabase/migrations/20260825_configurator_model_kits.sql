-- Прайс душевых ПО МОДЕЛЯМ. Два уровня, чтобы цену позиции вбивать один раз:
--   configurator_library   — позиции тарифа (наименование, роль, цены по цветам, хлысты, ссылка на справочник)
--   configurator_model_kits — комплект модели: слоты ролей со ссылками на позиции (порядок, ★, правило количества)
-- Количество каждой роли даёт геометрия визуализатора, здесь его нет.

CREATE TABLE IF NOT EXISTS public.configurator_library (
  tier       text PRIMARY KEY,                       -- 'budget' | 'premium'
  items      jsonb NOT NULL DEFAULT '[]'::jsonb,     -- LibraryItem[]
  rates      jsonb NOT NULL DEFAULT '{}'::jsonb,     -- стекло ₽/м², монтаж, доставка, подъём, пропил
  updated_by text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.configurator_model_kits (
  tier       text NOT NULL,
  model_code text NOT NULL,                          -- 'М1' … 'М12'
  kit        jsonb NOT NULL DEFAULT '{"slots":[]}'::jsonb,
  updated_by text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tier, model_code)
);

ALTER TABLE public.configurator_library    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.configurator_model_kits ENABLE ROW LEVEL SECURITY;

-- Себестоимость наружу не отдаём: читает только сервер (service-role), клиенту уходит уже цена.
-- Политик для authenticated нет намеренно — расчёт идёт через /api/configurator/quote.
