-- ══════════════════════════════════════════════════════════════════════════════
-- M-Glass — backfill V2-only себестоимостных позиций зеркал с подсветкой.
--
-- Цель: дать V2-калькулятору (lib/pricing/calculateMirrorUnified.ts) две
-- недостающие cost-строки — «Сборка зеркала с подсветкой» и «Расходники
-- подсветки» — НЕ затрагивая боевую цену.
--
-- Почему live-цена не изменится:
--   - lib/mirrorCalculator.ts вообще не ищет эти два имени через findMat.
--     Live смотрит только: «Сборка зеркала», «Сборка зеркала с пескоструем»,
--     «Комплектующие зеркала», «Сенсорная кнопка», «Датчик взмаха»,
--     «Пескоструй». Δ live-цены = 0 ₽ на всех сценариях.
--   - V2-preview (calculateMirrorUnified.ts) ищет «Сборка зеркала с
--     подсветкой» по приоритету при hasLighting; «Расходники подсветки»
--     зарезервированы под будущий V2 lighting consumables flow.
--
-- Что НЕ делает:
--   - не активирует и не трогает «Сборка зеркала», «Сборка зеркала с
--     пескоструем», «Комплектующие зеркала» — их активация подняла бы
--     live-цену (см. audit аудит 2026-06-24, Δ ≈ +2500…+3542 ₽).
--   - не трогает glass_price_matrix / services / mirror_lighting_components /
--     pricing_tiers_v2 / pricing_model_config_v2.
--   - не правит существующие cost_price > 0 (admin мог выставить значение
--     вручную — не перетираем).
--
-- Идемпотентность:
--   - INSERT через INSERT … SELECT … WHERE NOT EXISTS — на materials.name
--     нет UNIQUE constraint, ON CONFLICT нельзя.
--   - UPDATE срабатывает только если cost_price IS NULL OR = 0
--     (защита от перетирания admin-значений). Если строка уже есть с
--     cost_price > 0 — оставляем как есть, обновляем только active=true
--     и comment, чтобы V2 точно её увидел.
--
-- Категория 'зеркало' выбрана из MATERIAL_CATEGORIES (lib/types.ts) и
-- соответствует уже применённой миграции 20260624_seed_mirror_material_
-- fallback_costs.sql.
-- ══════════════════════════════════════════════════════════════════════════════

-- ─── 1. Сборка зеркала с подсветкой (V2 cost = 2500 ₽/шт) ────────────────────
-- LIVE не читает эту строку. V2: приоритетный выбор при hasLighting в
-- lib/pricing/calculateMirrorUnified.ts:240.
INSERT INTO public.materials (
  name, short_name, category, unit,
  cost_price, sale_price,
  has_vat, vat_rate,
  active, in_stock, comment
)
SELECT
  'Сборка зеркала с подсветкой', NULL, 'зеркало', 'шт',
  2500, NULL,
  false, 20,
  true, true,
  'V2-only cost item. Live mirror calculator does not use this material.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.materials WHERE name = 'Сборка зеркала с подсветкой'
);

UPDATE public.materials
SET cost_price = 2500,
    active     = true,
    comment    = 'V2-only cost item. Live mirror calculator does not use this material.',
    updated_at = now()
WHERE name = 'Сборка зеркала с подсветкой'
  AND (cost_price IS NULL OR cost_price = 0);

-- Если строка уже была с admin-заданным cost_price > 0 — не перетираем цену,
-- но гарантируем active=true, чтобы V2-findMat (фильтр active) её увидел.
UPDATE public.materials
SET active     = true,
    updated_at = now()
WHERE name = 'Сборка зеркала с подсветкой'
  AND cost_price > 0
  AND active = false;

-- ─── 2. Расходники подсветки (V2 cost = 500 ₽/шт) ────────────────────────────
-- LIVE не читает эту строку. V2 сейчас её тоже не ищет напрямую, но позиция
-- резервируется под будущий V2 lighting consumables flow. Безопасно сидится
-- сейчас, так как ни один калькулятор её не выбирает.
INSERT INTO public.materials (
  name, short_name, category, unit,
  cost_price, sale_price,
  has_vat, vat_rate,
  active, in_stock, comment
)
SELECT
  'Расходники подсветки', NULL, 'зеркало', 'шт',
  500, NULL,
  false, 20,
  true, true,
  'V2-only lighting consumables. Live mirror calculator does not use this material yet.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.materials WHERE name = 'Расходники подсветки'
);

UPDATE public.materials
SET cost_price = 500,
    active     = true,
    comment    = 'V2-only lighting consumables. Live mirror calculator does not use this material yet.',
    updated_at = now()
WHERE name = 'Расходники подсветки'
  AND (cost_price IS NULL OR cost_price = 0);

UPDATE public.materials
SET active     = true,
    updated_at = now()
WHERE name = 'Расходники подсветки'
  AND cost_price > 0
  AND active = false;
