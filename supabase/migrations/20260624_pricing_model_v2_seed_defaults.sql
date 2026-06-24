-- ══════════════════════════════════════════════════════════════════════════════
-- M-Glass Financial Model V2 — дефолтные данные (seed only).
--
-- Применяется ПОСЛЕ 20260624_pricing_model_v2_schema.sql (схема таблиц).
-- Алфавитный порядок имён файлов гарантирует правильную последовательность:
--   ..._schema.sql      ← создаёт таблицы
--   ..._seed_defaults.sql ← заливает дефолты (этот файл)
--
-- Что добавляется:
--   1. 4 дефолтных tier'а в pricing_tiers_v2
--        b2b_base              0% (контрольный)
--        external_b2b_standard 10%
--        external_b2b_vip      15%
--        internal_b2c          20% (M-Glass B2C transfer pricing)
--   2. 1 конфиг финмодели в pricing_model_config_v2
--        product_category='mirror' с дефолтами по аудиту
--
-- Что НЕ делает:
--   - НЕ сидит конфиги для shower / loft / glass_b2b / other
--     (категории появятся в схеме CHECK, но финмодель для них пока
--      не спроектирована — отдельный шаг по согласованию с CFO)
--   - НЕ меняет схему таблиц (никаких ALTER)
--   - НЕ трогает financial_settings / production_settings / partner_types /
--     b2b_catalog_*_v2 / materials / services / live калькуляторы
--
-- Идемпотентно: миграция использует INSERT ... ON CONFLICT DO UPDATE.
-- Повторное применение перезатрёт значения дефолтами (обновит updated_at),
-- но не удалит другие tiers/configs, добавленные позже вручную в админке.
-- ══════════════════════════════════════════════════════════════════════════════

-- ─── 1. pricing_tiers_v2 — дефолтные tiers ──────────────────────────────────
INSERT INTO public.pricing_tiers_v2 (
  code,
  name,
  channel_type,
  discount_percent,
  min_margin_percent,
  active,
  sort_order,
  notes
)
VALUES
  (
    'b2b_base',
    'B2B база без скидки',
    'b2b_base',
    0,
    NULL,
    true,
    10,
    'Базовая B2B цена без скидки. Используется как контрольный tier.'
  ),
  (
    'external_b2b_standard',
    'Внешний B2B стандарт',
    'external_b2b',
    10,
    NULL,
    true,
    20,
    'Стандартная скидка для внешних B2B партнёров.'
  ),
  (
    'external_b2b_vip',
    'Внешний B2B VIP',
    'external_b2b',
    15,
    NULL,
    true,
    30,
    'Повышенная скидка для крупных внешних B2B партнёров.'
  ),
  (
    'internal_b2c',
    'M-Glass B2C внутренний',
    'internal_b2c',
    20,
    NULL,
    true,
    40,
    'Внутренняя трансфертная цена для собственного B2C подразделения M-Glass.'
  )
ON CONFLICT (code) DO UPDATE
SET
  name               = EXCLUDED.name,
  channel_type       = EXCLUDED.channel_type,
  discount_percent   = EXCLUDED.discount_percent,
  min_margin_percent = EXCLUDED.min_margin_percent,
  active             = EXCLUDED.active,
  sort_order         = EXCLUDED.sort_order,
  notes              = EXCLUDED.notes,
  updated_at         = now();

-- ─── 2. pricing_model_config_v2 — конфиг для зеркал ──────────────────────────
-- Дефолты подобраны так, что worst-case tier (internal_b2c −20%)
-- оставляет factory маржу 22.5% (выше minimum 20%).
-- Формула: b2b_base_margin (38%) → после −20% → factory profit = 18%
-- от выручки B2B Base = 22.5% от Internal Transfer Price.
INSERT INTO public.pricing_model_config_v2 (
  product_category,
  factory_overhead_percent,
  scrap_reserve_percent,
  packaging_cost_per_m2,
  b2b_base_margin_percent,
  minimum_b2b_margin_after_discount,
  b2c_commercial_costs_percent,
  b2c_margin_percent,
  b2c_min_margin_percent,
  effective_from,
  active,
  notes
)
VALUES (
  'mirror',
  20,    -- factory_overhead_percent
  5,     -- scrap_reserve_percent
  120,   -- packaging_cost_per_m2 (₽/м²)
  38,    -- b2b_base_margin_percent (CFO invariant: ≥ 36% при max tier 20% + min 20%)
  20,    -- minimum_b2b_margin_after_discount
  22,    -- b2c_commercial_costs_percent
  35,    -- b2c_margin_percent
  25,    -- b2c_min_margin_percent
  current_date,
  true,
  'Default pricing model config for mirror products. Factory → B2B Base → Tier → B2C → Services.'
)
ON CONFLICT (product_category) DO UPDATE
SET
  factory_overhead_percent          = EXCLUDED.factory_overhead_percent,
  scrap_reserve_percent             = EXCLUDED.scrap_reserve_percent,
  packaging_cost_per_m2             = EXCLUDED.packaging_cost_per_m2,
  b2b_base_margin_percent           = EXCLUDED.b2b_base_margin_percent,
  minimum_b2b_margin_after_discount = EXCLUDED.minimum_b2b_margin_after_discount,
  b2c_commercial_costs_percent      = EXCLUDED.b2c_commercial_costs_percent,
  b2c_margin_percent                = EXCLUDED.b2c_margin_percent,
  b2c_min_margin_percent            = EXCLUDED.b2c_min_margin_percent,
  effective_from                    = EXCLUDED.effective_from,
  active                            = EXCLUDED.active,
  notes                             = EXCLUDED.notes,
  updated_at                        = now();
