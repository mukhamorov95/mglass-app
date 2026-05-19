-- ── Расширение b2b_services: поля для расчёта себестоимости ──────────────────
-- Аддитивные изменения только. Существующие строки не затрагиваются (DEFAULT NULL/0).

-- Норма времени мастера на операцию (мин). > 0 означает «рассчитываемая» услуга.
ALTER TABLE b2b_services ADD COLUMN IF NOT EXISTS time_minutes            NUMERIC(8,2)  DEFAULT 0     NOT NULL;
-- Амортизация оборудования на одну операцию (₽)
ALTER TABLE b2b_services ADD COLUMN IF NOT EXISTS equipment_depr_rub      NUMERIC(12,2) DEFAULT 0     NOT NULL;
-- Расходники на одну операцию (₽): диски, пасты, круги и т.д.
ALTER TABLE b2b_services ADD COLUMN IF NOT EXISTS consumables_cost_rub    NUMERIC(12,2) DEFAULT 0     NOT NULL;
-- Переопределение накладных расходов для конкретной услуги (NULL = брать из production_settings)
ALTER TABLE b2b_services ADD COLUMN IF NOT EXISTS overhead_override_pct   NUMERIC(5,2)  DEFAULT NULL;
-- Переопределение наценки для конкретной услуги (NULL = брать из production_settings)
ALTER TABLE b2b_services ADD COLUMN IF NOT EXISTS margin_override_pct     NUMERIC(5,2)  DEFAULT NULL;
-- Ручная цена продажи — если задана, перебивает автоматический расчёт
ALTER TABLE b2b_services ADD COLUMN IF NOT EXISTS sale_price_override     NUMERIC(12,2) DEFAULT NULL;
-- Диапазоны по размеру: [{ label, max_mm, time_minutes, consumables_cost_rub }]
ALTER TABLE b2b_services ADD COLUMN IF NOT EXISTS size_tiers              JSONB         DEFAULT '[]'::jsonb NOT NULL;
-- Отображаемая единица в калькуляторе (₽/шт, ₽/м² и т.д.)
ALTER TABLE b2b_services ADD COLUMN IF NOT EXISTS unit_label              TEXT          DEFAULT '₽/шт';

-- Обновить CHECK-ограничение на type: добавить 'calculated'
-- Используем динамический поиск имени ограничения, чтобы не зависеть от auto-имени
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'b2b_services'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%type%'
  LOOP
    EXECUTE 'ALTER TABLE b2b_services DROP CONSTRAINT ' || quote_ident(r.conname);
  END LOOP;
END $$;

ALTER TABLE b2b_services
  ADD CONSTRAINT b2b_services_type_check
  CHECK (type IN ('percent', 'per_m2', 'fixed', 'calculated'));

-- ── Сидировать новую услугу "Обработка кривых деталей" ───────────────────────
INSERT INTO b2b_services (name, type, value, cost_price, description, active, sort_order,
                          time_minutes, equipment_depr_rub, consumables_cost_rub,
                          size_tiers, unit_label)
VALUES (
  'Обработка кривых деталей (полировка торца)',
  'calculated',
  2850,   -- базовая цена продажи (пересчитается в admin)
  1300,   -- базовая себестоимость (пересчитается)
  'Полировка торца криволинейного изделия на станке',
  true,
  100,
  20,     -- базовое время (мин), переопределяется size_tiers
  30,     -- амортизация шлифмашины (₽/операцию)
  80,     -- расходники: диски, паста (₽/операцию)
  '[
    {"label": "до 500 мм",       "max_mm": 500,  "time_minutes": 10, "consumables_cost_rub": 50},
    {"label": "500–1000 мм",     "max_mm": 1000, "time_minutes": 20, "consumables_cost_rub": 80},
    {"label": "свыше 1000 мм",   "max_mm": null, "time_minutes": 35, "consumables_cost_rub": 120}
  ]'::jsonb,
  '₽/шт'
)
ON CONFLICT DO NOTHING;
