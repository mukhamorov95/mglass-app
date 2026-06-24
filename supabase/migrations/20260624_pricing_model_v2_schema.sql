-- ══════════════════════════════════════════════════════════════════════════════
-- M-Glass Financial Model V2 — структура pricing-конфига.
--
-- Создаёт две независимые таблицы для будущего трёх-уровневого ценообразования:
--   Factory Cost → B2B Base Price → Tier discount → (B2C layer) → Final Price
--
--   1. pricing_tiers_v2          — скидочные уровни по каналам продажи
--                                  (external_b2b / internal_b2c / b2b_base / retail_b2c)
--   2. pricing_model_config_v2   — конфиг финансовой модели по категории продукта
--                                  (mirror / shower / loft / glass_b2b / other)
--
-- Что миграция НЕ делает:
--   - не трогает financial_settings / production_settings / partner_types
--   - не трогает b2b_catalog_*_v2
--   - не трогает live калькуляторы и их таблицы
--   - не сидит дефолтные значения (seed — отдельным шагом)
--   - не меняет существующие миграции
--   - функция public.update_updated_at_column() уже определена ранее
--     (впервые в 20250513_b2b_clients_updated_at.sql) — не пересоздаём.
-- ══════════════════════════════════════════════════════════════════════════════

-- ─── 1. pricing_tiers_v2 ─────────────────────────────────────────────────────
-- Per-channel pricing tier. Discount применяется к B2B Base Price.
-- Внутренний M-Glass B2C — это просто tier с большой скидкой (transfer pricing).
CREATE TABLE IF NOT EXISTS public.pricing_tiers_v2 (
  id                  bigserial     PRIMARY KEY,
  code                text          NOT NULL UNIQUE,
  name                text          NOT NULL,
  channel_type        text          NOT NULL
                        CHECK (channel_type IN (
                          'external_b2b',
                          'internal_b2c',
                          'b2b_base',
                          'retail_b2c'
                        )),
  discount_percent    numeric(5,2)  NOT NULL DEFAULT 0
                        CHECK (discount_percent >= 0 AND discount_percent < 100),
  -- override глобального minimum_b2b_margin_after_discount; NULL = берём из конфига
  min_margin_percent  numeric(5,2)
                        CHECK (min_margin_percent IS NULL OR (
                          min_margin_percent >= 0 AND min_margin_percent < 100
                        )),
  active              boolean       NOT NULL DEFAULT true,
  sort_order          integer       NOT NULL DEFAULT 0,
  notes               text,
  created_at          timestamptz   NOT NULL DEFAULT now(),
  updated_at          timestamptz   NOT NULL DEFAULT now()
);

-- ─── 2. pricing_model_config_v2 ──────────────────────────────────────────────
-- Глобальный конфиг финмодели на категорию продукта. Один ряд на категорию.
-- Дефолтные значения подобраны так, что внутренний tier 20% оставляет
-- factory ~22.5% маржу (выше minimum 20%).
CREATE TABLE IF NOT EXISTS public.pricing_model_config_v2 (
  id                                 bigserial     PRIMARY KEY,
  product_category                   text          NOT NULL UNIQUE
                                       CHECK (product_category IN (
                                         'mirror',
                                         'shower',
                                         'loft',
                                         'glass_b2b',
                                         'other'
                                       )),
  -- Factory layer
  factory_overhead_percent           numeric(5,2)  NOT NULL DEFAULT 20
                                       CHECK (factory_overhead_percent >= 0
                                              AND factory_overhead_percent < 100),
  scrap_reserve_percent              numeric(5,2)  NOT NULL DEFAULT 5
                                       CHECK (scrap_reserve_percent >= 0
                                              AND scrap_reserve_percent < 100),
  packaging_cost_per_m2              numeric(12,2) NOT NULL DEFAULT 120
                                       CHECK (packaging_cost_per_m2 >= 0),
  -- B2B Base layer
  b2b_base_margin_percent            numeric(5,2)  NOT NULL DEFAULT 38
                                       CHECK (b2b_base_margin_percent >= 0
                                              AND b2b_base_margin_percent < 100),
  minimum_b2b_margin_after_discount  numeric(5,2)  NOT NULL DEFAULT 20
                                       CHECK (minimum_b2b_margin_after_discount >= 0
                                              AND minimum_b2b_margin_after_discount < 100),
  -- B2C layer (используется только для каналов internal_b2c / retail_b2c)
  b2c_commercial_costs_percent       numeric(5,2)  NOT NULL DEFAULT 22
                                       CHECK (b2c_commercial_costs_percent >= 0
                                              AND b2c_commercial_costs_percent < 100),
  b2c_margin_percent                 numeric(5,2)  NOT NULL DEFAULT 35
                                       CHECK (b2c_margin_percent >= 0
                                              AND b2c_margin_percent < 100),
  b2c_min_margin_percent             numeric(5,2)  NOT NULL DEFAULT 25
                                       CHECK (b2c_min_margin_percent >= 0
                                              AND b2c_min_margin_percent < 100),
  -- Audit / lifecycle
  effective_from                     date          NOT NULL DEFAULT current_date,
  active                             boolean       NOT NULL DEFAULT true,
  notes                              text,
  created_at                         timestamptz   NOT NULL DEFAULT now(),
  updated_at                         timestamptz   NOT NULL DEFAULT now(),
  -- Денoм B2C-формулы должен быть положительным: commercial + margin < 100%
  CONSTRAINT pricing_model_config_v2_b2c_denom_check
    CHECK (b2c_commercial_costs_percent + b2c_margin_percent < 100)
);

-- ══════════════════════════════════════════════════════════════════════════════
-- ИНДЕКСЫ
-- ══════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_pricing_tiers_v2_active
  ON public.pricing_tiers_v2(active);

CREATE INDEX IF NOT EXISTS idx_pricing_tiers_v2_channel_type
  ON public.pricing_tiers_v2(channel_type);

CREATE INDEX IF NOT EXISTS idx_pricing_tiers_v2_sort_order
  ON public.pricing_tiers_v2(sort_order);

CREATE INDEX IF NOT EXISTS idx_pricing_model_config_v2_active
  ON public.pricing_model_config_v2(active);

CREATE INDEX IF NOT EXISTS idx_pricing_model_config_v2_category
  ON public.pricing_model_config_v2(product_category);

CREATE INDEX IF NOT EXISTS idx_pricing_model_config_v2_effective_from
  ON public.pricing_model_config_v2(effective_from);

-- ══════════════════════════════════════════════════════════════════════════════
-- UPDATED_AT TRIGGERS
-- Функция public.update_updated_at_column() уже определена ранее
-- (20250513_b2b_clients_updated_at.sql, CREATE OR REPLACE).
-- ══════════════════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS update_pricing_tiers_v2_updated_at
  ON public.pricing_tiers_v2;
CREATE TRIGGER update_pricing_tiers_v2_updated_at
  BEFORE UPDATE ON public.pricing_tiers_v2
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_pricing_model_config_v2_updated_at
  ON public.pricing_model_config_v2;
CREATE TRIGGER update_pricing_model_config_v2_updated_at
  BEFORE UPDATE ON public.pricing_model_config_v2
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ══════════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- Стиль проекта (b2b_films, b2b_catalog_*_v2):
--   authenticated SELECT: USING (true)
--   authenticated ALL:    USING (true) WITH CHECK (true)
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.pricing_tiers_v2         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_model_config_v2  ENABLE ROW LEVEL SECURITY;

-- pricing_tiers_v2
DROP POLICY IF EXISTS "Authenticated users can read pricing tiers v2"
  ON public.pricing_tiers_v2;
CREATE POLICY "Authenticated users can read pricing tiers v2"
  ON public.pricing_tiers_v2
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated users can manage pricing tiers v2"
  ON public.pricing_tiers_v2;
CREATE POLICY "Authenticated users can manage pricing tiers v2"
  ON public.pricing_tiers_v2
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- pricing_model_config_v2
DROP POLICY IF EXISTS "Authenticated users can read pricing model config v2"
  ON public.pricing_model_config_v2;
CREATE POLICY "Authenticated users can read pricing model config v2"
  ON public.pricing_model_config_v2
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated users can manage pricing model config v2"
  ON public.pricing_model_config_v2;
CREATE POLICY "Authenticated users can manage pricing model config v2"
  ON public.pricing_model_config_v2
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);
