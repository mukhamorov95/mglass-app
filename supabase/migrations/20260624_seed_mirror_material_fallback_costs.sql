-- ══════════════════════════════════════════════════════════════════════════════
-- M-Glass — backfill материалов с cost_price, равным текущим hardcoded
-- fallback'ам в live калькуляторе зеркал.
--
-- Цель: после применения live-цена НЕ должна измениться. В коде
-- lib/mirrorCalculator.ts при отсутствии материала с такими именами
-- подставляются магические числа:
--   'Сенсорная кнопка' → 400
--   'Датчик взмаха'    → 800
--   'Пескоструй'       → 1200
-- Эта миграция заводит реальные строки с теми же cost_price. Калькулятор
-- тогда будет читать материал из БД с теми же значениями — Δ цены = 0.
--
-- Что НЕ делает:
--   - не заводит «Сборка зеркала», «Сборка зеркала с подсветкой»,
--     «Сборка зеркала с пескоструем», «Комплектующие зеркала»,
--     «Расходники подсветки», «Упаковка зеркала»
--   - не трогает glass_price_matrix / services / mirror_lighting_components
--   - не правит существующие cost_price > 0 (admin может выставить выше —
--     не перетираем)
--
-- Идемпотентность:
--   - INSERT через INSERT … SELECT … WHERE NOT EXISTS — на materials.name
--     нет UNIQUE constraint, ON CONFLICT нельзя
--   - UPDATE срабатывает только если cost_price IS NULL OR = 0
--     (защита от перетирания admin-значений)
--
-- Категория 'зеркало' выбрана из MATERIAL_CATEGORIES (lib/types.ts):
-- 'зеркало','стекло','подсветка','профиль','электрика','расходники',
-- 'работа','услуга','фурнитура'. Соответствует дефолту admin-UI
-- (app/admin/materials/page.tsx:22).
-- ══════════════════════════════════════════════════════════════════════════════

-- ─── 1. Сенсорная кнопка (fallback = 400 ₽) ──────────────────────────────────
INSERT INTO public.materials (
  name, short_name, category, unit,
  cost_price, sale_price,
  has_vat, vat_rate,
  active, in_stock, comment
)
SELECT
  'Сенсорная кнопка', NULL, 'зеркало', 'шт',
  400, NULL,
  false, 20,
  true, true, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.materials WHERE name = 'Сенсорная кнопка'
);

UPDATE public.materials
SET cost_price = 400,
    updated_at = now()
WHERE name = 'Сенсорная кнопка'
  AND (cost_price IS NULL OR cost_price = 0);

-- ─── 2. Датчик взмаха (fallback = 800 ₽) ─────────────────────────────────────
INSERT INTO public.materials (
  name, short_name, category, unit,
  cost_price, sale_price,
  has_vat, vat_rate,
  active, in_stock, comment
)
SELECT
  'Датчик взмаха', NULL, 'зеркало', 'шт',
  800, NULL,
  false, 20,
  true, true, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.materials WHERE name = 'Датчик взмаха'
);

UPDATE public.materials
SET cost_price = 800,
    updated_at = now()
WHERE name = 'Датчик взмаха'
  AND (cost_price IS NULL OR cost_price = 0);

-- ─── 3. Пескоструй (fallback = 1200 ₽/м²) ────────────────────────────────────
-- Unit = 'м²': калькулятор умножает cost_price × area для пескоструйной
-- обработки (mirrorCalculator.ts:222).
INSERT INTO public.materials (
  name, short_name, category, unit,
  cost_price, sale_price,
  has_vat, vat_rate,
  active, in_stock, comment
)
SELECT
  'Пескоструй', NULL, 'зеркало', 'м²',
  1200, NULL,
  false, 20,
  true, true, NULL
WHERE NOT EXISTS (
  SELECT 1 FROM public.materials WHERE name = 'Пескоструй'
);

UPDATE public.materials
SET cost_price = 1200,
    updated_at = now()
WHERE name = 'Пескоструй'
  AND (cost_price IS NULL OR cost_price = 0);
