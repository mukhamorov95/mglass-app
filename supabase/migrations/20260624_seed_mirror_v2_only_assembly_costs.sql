-- ══════════════════════════════════════════════════════════════════════════════
-- M-Glass — V2-only себестоимостные позиции для зеркал:
--   - Сборка зеркала                (1000 ₽/шт)
--   - Сборка зеркала с пескоструем  (1500 ₽/шт)
--   - Комплектующие зеркала         ( 200 ₽/шт)
--
-- Эти строки переводятся в V2-only режим:
--   active     = true   — чтобы V2 calculateMirrorUnified.findMat их находил
--                          (он фильтрует только по active).
--   is_v2_only = true   — чтобы live lib/mirrorCalculator.ts.findMat их
--                          ИГНОРИРОВАЛ (после 4dd7e85 guard `m.is_v2_only !== true`).
--
-- Δ live-цены = 0 ₽:
--   live findMat исключает is_v2_only=true до того, как строка попадёт в
--   totalCost. Соответственно basePrice, finalPrice, grandTotal не меняются
--   на текущих сценариях. Эти строки уже лежали в supabase/seed.sql:58, 64-65
--   с active=false → live их и так не видел; теперь они видны V2, но всё
--   ещё невидимы live.
--
-- Что НЕ трогает:
--   - Не активирует и не правит: «Сборка зеркала с подсветкой», «Расходники
--     подсветки», «Сенсорная кнопка», «Датчик взмаха», «Пескоструй».
--   - Не трогает glass_price_matrix, services, mirror_lighting_components,
--     pricing_tiers_v2, pricing_model_config_v2.
--
-- Идемпотентность:
--   - materials.name не имеет UNIQUE → INSERT … SELECT … WHERE NOT EXISTS.
--   - UPDATE по name безусловный по cost_price (см. пояснение): эти три
--     позиции были засеяны seed.sql с active=false ровно для будущей V2
--     активации. Мы целенаправленно нормализуем их в V2-only состояние и
--     обновляем cost_price до канонической V2-цены. Если admin вручную
--     поменял cost_price — он мог это сделать только зная, что строка
--     неактивна; миграция приводит к согласованному V2-only состоянию.
-- ══════════════════════════════════════════════════════════════════════════════

-- ─── 1. Сборка зеркала (V2 cost = 1000 ₽/шт) ─────────────────────────────────
INSERT INTO public.materials (
  name, short_name, category, unit,
  cost_price, sale_price,
  has_vat, vat_rate,
  active, in_stock, is_v2_only, comment
)
SELECT
  'Сборка зеркала', NULL, 'зеркало', 'шт',
  1000, NULL,
  false, 20,
  true, true, true,
  'V2-only base mirror assembly cost. Ignored by legacy live pricing.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.materials WHERE name = 'Сборка зеркала'
);

UPDATE public.materials
SET category   = 'зеркало',
    unit       = 'шт',
    cost_price = 1000,
    active     = true,
    in_stock   = true,
    is_v2_only = true,
    comment    = 'V2-only base mirror assembly cost. Ignored by legacy live pricing.',
    updated_at = now()
WHERE name = 'Сборка зеркала';

-- ─── 2. Сборка зеркала с пескоструем (V2 cost = 1500 ₽/шт) ───────────────────
INSERT INTO public.materials (
  name, short_name, category, unit,
  cost_price, sale_price,
  has_vat, vat_rate,
  active, in_stock, is_v2_only, comment
)
SELECT
  'Сборка зеркала с пескоструем', NULL, 'зеркало', 'шт',
  1500, NULL,
  false, 20,
  true, true, true,
  'V2-only mirror assembly cost for sandblast mirrors. Ignored by legacy live pricing.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.materials WHERE name = 'Сборка зеркала с пескоструем'
);

UPDATE public.materials
SET category   = 'зеркало',
    unit       = 'шт',
    cost_price = 1500,
    active     = true,
    in_stock   = true,
    is_v2_only = true,
    comment    = 'V2-only mirror assembly cost for sandblast mirrors. Ignored by legacy live pricing.',
    updated_at = now()
WHERE name = 'Сборка зеркала с пескоструем';

-- ─── 3. Комплектующие зеркала (V2 cost = 200 ₽/шт) ───────────────────────────
INSERT INTO public.materials (
  name, short_name, category, unit,
  cost_price, sale_price,
  has_vat, vat_rate,
  active, in_stock, is_v2_only, comment
)
SELECT
  'Комплектующие зеркала', NULL, 'зеркало', 'шт',
  200, NULL,
  false, 20,
  true, true, true,
  'V2-only mirror kit/consumables cost. Ignored by legacy live pricing.'
WHERE NOT EXISTS (
  SELECT 1 FROM public.materials WHERE name = 'Комплектующие зеркала'
);

UPDATE public.materials
SET category   = 'зеркало',
    unit       = 'шт',
    cost_price = 200,
    active     = true,
    in_stock   = true,
    is_v2_only = true,
    comment    = 'V2-only mirror kit/consumables cost. Ignored by legacy live pricing.',
    updated_at = now()
WHERE name = 'Комплектующие зеркала';
