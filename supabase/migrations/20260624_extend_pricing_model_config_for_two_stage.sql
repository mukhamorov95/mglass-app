-- ══════════════════════════════════════════════════════════════════════════════
-- M-Glass — расширение pricing_model_config_v2 под двухступенчатую финмодель.
--
-- Добавляются 3 новых поля:
--   production_tax_percent    — налог производства (Stage 1)
--   production_margin_percent — маржа производства (Stage 1)
--   b2c_tax_percent           — налог B2C (Stage 2)
--
-- Поле b2c_margin_percent уже существует (схема 20260624_pricing_model_v2_schema.sql,
-- DEFAULT 35) — используется как маржа B2C для two-stage. Дефолт обновляется
-- через UPDATE для product_category='mirror' (40%), чтобы соответствовать
-- спецификации two-stage. Старые конфиги других категорий остаются нетронутыми.
--
-- CHECK constraints обеспечивают положительный знаменатель двух-ступенчатой формулы:
--   1 - tax/100 - margin/100 > 0  ⇔  tax + margin < 100
--
-- Что миграция НЕ делает:
--   - не трогает pricing_tiers_v2
--   - не пересоздаёт существующие колонки
--   - не удаляет существующий CHECK pricing_model_config_v2_b2c_denom_check
--     (commercial + margin < 100) — он продолжает действовать наряду с новым
--     two-stage check (b2c_tax + b2c_margin < 100). Обе модели сосуществуют.
--
-- Идемпотентность:
--   - ADD COLUMN IF NOT EXISTS — безопасно при повторном применении.
--   - CHECK constraints через DROP IF EXISTS / ADD — пересоздаются с тем же именем.
--   - UPDATE сидит только product_category='mirror'.
-- ══════════════════════════════════════════════════════════════════════════════

-- ─── 1. Добавить новые колонки ──────────────────────────────────────────────
ALTER TABLE public.pricing_model_config_v2
  ADD COLUMN IF NOT EXISTS production_tax_percent    numeric(5,2) NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS production_margin_percent numeric(5,2) NOT NULL DEFAULT 40,
  ADD COLUMN IF NOT EXISTS b2c_tax_percent           numeric(5,2) NOT NULL DEFAULT 12;

-- ─── 2. CHECK constraints для two-stage формулы ─────────────────────────────
ALTER TABLE public.pricing_model_config_v2
  DROP CONSTRAINT IF EXISTS pricing_model_config_v2_production_tax_range;
ALTER TABLE public.pricing_model_config_v2
  ADD  CONSTRAINT pricing_model_config_v2_production_tax_range
       CHECK (production_tax_percent >= 0 AND production_tax_percent < 100);

ALTER TABLE public.pricing_model_config_v2
  DROP CONSTRAINT IF EXISTS pricing_model_config_v2_production_margin_range;
ALTER TABLE public.pricing_model_config_v2
  ADD  CONSTRAINT pricing_model_config_v2_production_margin_range
       CHECK (production_margin_percent >= 0 AND production_margin_percent < 100);

ALTER TABLE public.pricing_model_config_v2
  DROP CONSTRAINT IF EXISTS pricing_model_config_v2_production_denom_check;
ALTER TABLE public.pricing_model_config_v2
  ADD  CONSTRAINT pricing_model_config_v2_production_denom_check
       CHECK (production_tax_percent + production_margin_percent < 100);

ALTER TABLE public.pricing_model_config_v2
  DROP CONSTRAINT IF EXISTS pricing_model_config_v2_b2c_tax_range;
ALTER TABLE public.pricing_model_config_v2
  ADD  CONSTRAINT pricing_model_config_v2_b2c_tax_range
       CHECK (b2c_tax_percent >= 0 AND b2c_tax_percent < 100);

ALTER TABLE public.pricing_model_config_v2
  DROP CONSTRAINT IF EXISTS pricing_model_config_v2_b2c_two_stage_denom_check;
ALTER TABLE public.pricing_model_config_v2
  ADD  CONSTRAINT pricing_model_config_v2_b2c_two_stage_denom_check
       CHECK (b2c_tax_percent + b2c_margin_percent < 100);

-- ─── 3. Seed для product_category='mirror' ──────────────────────────────────
-- Two-stage дефолты: 12/40/12/40. Существующие other-категории не трогаем.
UPDATE public.pricing_model_config_v2
   SET production_tax_percent    = 12,
       production_margin_percent = 40,
       b2c_tax_percent           = 12,
       b2c_margin_percent        = 40,
       updated_at                = now()
 WHERE product_category = 'mirror';
