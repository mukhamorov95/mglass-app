-- ══════════════════════════════════════════════════════════════════════════════
-- M-Glass — флаг is_v2_only для public.materials.
--
-- Назначение:
--   Маркирует строки materials, которые предназначены ТОЛЬКО для V2 pricing
--   preview/моделей и должны игнорироваться legacy live-калькулятором
--   (lib/mirrorCalculator.ts).
--
-- Почему это нужно:
--   Live-калькулятор сейчас ищет материалы через findMat(materials, name) и
--   подхватывает любой active=true. Без флага активация позиций вроде
--   «Сборка зеркала», «Сборка зеркала с пескоструем», «Комплектующие
--   зеркала» неминуемо поднимет боевую цену (audit 2026-06-24:
--   Δ ≈ +2500…+3542 ₽ за изделие). С флагом live позже сможет фильтровать
--   `is_v2_only = false`, оставаясь нейтральным к V2-only позициям.
--
-- Эта миграция — ТОЛЬКО schema-change:
--   - НЕ активирует никакие материалы (никаких UPDATE active=true).
--   - НЕ заводит и НЕ удаляет строки (никаких INSERT/DELETE).
--   - НЕ читает и НЕ пишет другие таблицы.
--   - НЕ меняет код приложения.
--
-- Безопасность:
--   - DEFAULT false означает: вся текущая боевая выборка V2-нейтральна по
--     умолчанию. Никакая существующая логика не меняет поведение.
--   - NOT NULL допустимо: PostgreSQL заполнит существующие строки default'ом
--     без блокирующего table rewrite (NOT NULL + DEFAULT constant; начиная
--     с PG 11 — fast-path metadata-only). На materials строк немного.
--   - ADD COLUMN IF NOT EXISTS и CREATE INDEX IF NOT EXISTS делают миграцию
--     идемпотентной — повторное применение не упадёт.
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS is_v2_only boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_materials_is_v2_only
  ON public.materials(is_v2_only);

COMMENT ON COLUMN public.materials.is_v2_only IS
  'Marks material rows that are intended only for V2 pricing previews/models and should be ignored by legacy live calculators.';
