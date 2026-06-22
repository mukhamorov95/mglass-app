-- ══════════════════════════════════════════════════════════════════════════════
-- B2B Catalogue v2 — независимый справочник нового калькулятора
-- Старые таблицы (b2b_materials, b2b_services, b2b_films, facet_prices,
-- production_settings) НЕ затрагиваются.
-- Seed-данные и импорт — отдельным шагом (этот файл: только структура).
-- ══════════════════════════════════════════════════════════════════════════════

-- ─── 1. b2b_catalog_materials_v2 ─────────────────────────────────────────────
-- Тип материала (верхний уровень иерархии справочника).
CREATE TABLE IF NOT EXISTS b2b_catalog_materials_v2 (
  id            bigserial     PRIMARY KEY,
  name          text          NOT NULL,
  material_type text          NOT NULL,
  category      text          NOT NULL,
  description   text,
  active        boolean       NOT NULL DEFAULT true,
  sort_order    integer       NOT NULL DEFAULT 0,
  created_at    timestamptz   NOT NULL DEFAULT now(),
  updated_at    timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT b2b_catalog_materials_v2_material_type_check
    CHECK (material_type IN ('glass', 'mirror', 'triplex', 'laminated', 'other'))
);

-- ─── 2. b2b_catalog_material_variants_v2 ─────────────────────────────────────
-- SKU: конкретный вариант материала (толщина + лист + поставщик).
CREATE TABLE IF NOT EXISTS b2b_catalog_material_variants_v2 (
  id                     bigserial     PRIMARY KEY,
  material_id            bigint        NOT NULL
                           REFERENCES b2b_catalog_materials_v2(id) ON DELETE CASCADE,
  thickness_mm           integer       NOT NULL,
  sheet_width_mm         integer       NOT NULL DEFAULT 3210,
  sheet_height_mm        integer       NOT NULL DEFAULT 2250,
  unit                   text          NOT NULL DEFAULT 'м²',
  waste_percent          numeric(5,2)  NOT NULL DEFAULT 15,
  passthrough_waste      boolean       NOT NULL DEFAULT false,
  pattern_direction      text          NOT NULL DEFAULT 'none',
  supplier_id            uuid          REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_sku           text,
  supplier_material_name text,
  is_default             boolean       NOT NULL DEFAULT false,
  active                 boolean       NOT NULL DEFAULT true,
  sort_order             integer       NOT NULL DEFAULT 0,
  notes                  text,
  created_at             timestamptz   NOT NULL DEFAULT now(),
  updated_at             timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT b2b_catalog_material_variants_v2_thickness_check
    CHECK (thickness_mm > 0),
  CONSTRAINT b2b_catalog_material_variants_v2_width_check
    CHECK (sheet_width_mm > 0),
  CONSTRAINT b2b_catalog_material_variants_v2_height_check
    CHECK (sheet_height_mm > 0),
  CONSTRAINT b2b_catalog_material_variants_v2_pattern_check
    CHECK (pattern_direction IN ('none', 'along_length', 'along_width'))
);

-- ─── 3. b2b_catalog_material_prices_v2 ───────────────────────────────────────
-- Цены варианта с датой вступления в силу + прайс конкурента (БСК).
CREATE TABLE IF NOT EXISTS b2b_catalog_material_prices_v2 (
  id                          bigserial     PRIMARY KEY,
  variant_id                  bigint        NOT NULL
                                REFERENCES b2b_catalog_material_variants_v2(id) ON DELETE CASCADE,
  cost_price_per_m2           numeric(12,2) NOT NULL DEFAULT 0,
  vat_rate                    numeric(5,2)  NOT NULL DEFAULT 22,
  sale_price_per_m2           numeric(12,2) NOT NULL DEFAULT 0,
  competitor_discounted_price numeric(12,2),          -- цена из прайса БСК (−15% уже учтена)
  competitor_base_price       numeric(12,2),          -- = round(discounted / 0.85) — восстановленная
  competitor_source           text,                   -- 'БСК 2025-06', 'Pilkington', ...
  competitor_updated_at       date,
  margin_pct                  numeric(5,2),           -- вычисляется при сохранении
  effective_from              date          NOT NULL DEFAULT current_date,
  created_at                  timestamptz   NOT NULL DEFAULT now(),
  updated_at                  timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT b2b_catalog_material_prices_v2_cost_check
    CHECK (cost_price_per_m2 >= 0),
  CONSTRAINT b2b_catalog_material_prices_v2_sale_check
    CHECK (sale_price_per_m2 >= 0),
  CONSTRAINT b2b_catalog_material_prices_v2_vat_check
    CHECK (vat_rate >= 0),
  CONSTRAINT b2b_catalog_material_prices_v2_unique_date
    UNIQUE (variant_id, effective_from)
);

-- ─── 4. b2b_catalog_services_v2 ──────────────────────────────────────────────
-- Услуги / работы с явным маппингом на производственный этап.
CREATE TABLE IF NOT EXISTS b2b_catalog_services_v2 (
  id                    bigserial     PRIMARY KEY,
  name                  text          NOT NULL,
  service_category      text          NOT NULL,
  unit                  text          NOT NULL DEFAULT '₽/шт',
  calc_type             text          NOT NULL,
  sale_price            numeric(12,2) NOT NULL DEFAULT 0,
  cost_price            numeric(12,2) NOT NULL DEFAULT 0,
  stage_key             text,                         -- NULL = нет производственного этапа
  auto_apply_when       text,                         -- 'hasTempering' | 'hasFacet' | NULL
  apply_rule            text,
  time_minutes          numeric(8,2)  DEFAULT 0,
  equipment_depr_rub    numeric(12,2) DEFAULT 0,
  consumables_cost_rub  numeric(12,2) DEFAULT 0,
  overhead_override_pct numeric(5,2),
  margin_override_pct   numeric(5,2),
  sale_price_override   numeric(12,2),
  active                boolean       NOT NULL DEFAULT true,
  sort_order            integer       NOT NULL DEFAULT 0,
  description           text,
  created_at            timestamptz   NOT NULL DEFAULT now(),
  updated_at            timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT b2b_catalog_services_v2_category_check
    CHECK (service_category IN (
      'processing', 'coating', 'tempering', 'lamination',
      'facet', 'packaging', 'delivery', 'other'
    )),
  CONSTRAINT b2b_catalog_services_v2_calc_type_check
    CHECK (calc_type IN ('per_m2', 'per_lm', 'fixed', 'percent', 'labor', 'film')),
  CONSTRAINT b2b_catalog_services_v2_stage_key_check
    CHECK (stage_key IS NULL OR stage_key IN (
      'material_wait', 'cutting', 'polishing', 'drilling',
      'shape_processing', 'facet', 'tempering', 'triplex',
      'film', 'packaging', 'shipped', 'problem'
    ))
);

-- ─── 5. b2b_catalog_service_prices_v2 ────────────────────────────────────────
-- Ценовые тиры по размеру детали.
CREATE TABLE IF NOT EXISTS b2b_catalog_service_prices_v2 (
  id                   bigserial     PRIMARY KEY,
  service_id           bigint        NOT NULL
                         REFERENCES b2b_catalog_services_v2(id) ON DELETE CASCADE,
  tier_label           text          NOT NULL,
  max_dim_mm           integer,                       -- NULL = без ограничения (последний тир)
  sale_price           numeric(12,2),
  time_minutes         numeric(8,2),
  consumables_cost_rub numeric(12,2),
  sort_order           integer       NOT NULL DEFAULT 0,
  created_at           timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT b2b_catalog_service_prices_v2_max_dim_check
    CHECK (max_dim_mm IS NULL OR max_dim_mm > 0)
);

-- ─── 6. b2b_catalog_constants_v2 ─────────────────────────────────────────────
-- Заменяет жёстко зашитые константы в lib/b2bCalculator.ts.
-- value_num — для скалярных значений, value_json — для таблиц (TEMPERING_COST, MIN_LINE_PRICES).
CREATE TABLE IF NOT EXISTS b2b_catalog_constants_v2 (
  key         text          PRIMARY KEY,
  value_num   numeric(12,4),
  value_json  jsonb,
  unit        text,
  description text,
  updated_at  timestamptz   NOT NULL DEFAULT now()
);

-- ══════════════════════════════════════════════════════════════════════════════
-- ИНДЕКСЫ
-- ══════════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_b2b_catalog_materials_v2_active
  ON b2b_catalog_materials_v2 (active);

CREATE INDEX IF NOT EXISTS idx_b2b_catalog_material_variants_v2_material_id
  ON b2b_catalog_material_variants_v2 (material_id);

CREATE INDEX IF NOT EXISTS idx_b2b_catalog_material_variants_v2_active
  ON b2b_catalog_material_variants_v2 (active);

CREATE INDEX IF NOT EXISTS idx_b2b_catalog_material_prices_v2_variant_id
  ON b2b_catalog_material_prices_v2 (variant_id);

CREATE INDEX IF NOT EXISTS idx_b2b_catalog_material_prices_v2_effective_from
  ON b2b_catalog_material_prices_v2 (effective_from);

CREATE INDEX IF NOT EXISTS idx_b2b_catalog_services_v2_active
  ON b2b_catalog_services_v2 (active);

CREATE INDEX IF NOT EXISTS idx_b2b_catalog_services_v2_stage_key
  ON b2b_catalog_services_v2 (stage_key);

CREATE INDEX IF NOT EXISTS idx_b2b_catalog_service_prices_v2_service_id
  ON b2b_catalog_service_prices_v2 (service_id);

-- ══════════════════════════════════════════════════════════════════════════════
-- UPDATED_AT TRIGGERS
-- Функция public.update_updated_at_column() уже определена в проекте
-- (впервые: 20250513_b2b_clients_updated_at.sql, CREATE OR REPLACE).
-- Создаём триггеры только для таблиц с полем updated_at.
-- b2b_catalog_service_prices_v2 и b2b_catalog_constants_v2 обновляются редко
-- и не имеют updated_at — триггеры не нужны.
-- ══════════════════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS set_b2b_catalog_materials_v2_updated_at
  ON b2b_catalog_materials_v2;
CREATE TRIGGER set_b2b_catalog_materials_v2_updated_at
  BEFORE UPDATE ON b2b_catalog_materials_v2
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_b2b_catalog_material_variants_v2_updated_at
  ON b2b_catalog_material_variants_v2;
CREATE TRIGGER set_b2b_catalog_material_variants_v2_updated_at
  BEFORE UPDATE ON b2b_catalog_material_variants_v2
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_b2b_catalog_material_prices_v2_updated_at
  ON b2b_catalog_material_prices_v2;
CREATE TRIGGER set_b2b_catalog_material_prices_v2_updated_at
  BEFORE UPDATE ON b2b_catalog_material_prices_v2
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_b2b_catalog_services_v2_updated_at
  ON b2b_catalog_services_v2;
CREATE TRIGGER set_b2b_catalog_services_v2_updated_at
  BEFORE UPDATE ON b2b_catalog_services_v2
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ══════════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- Стиль проекта (b2b_films, b2b_material_sheet_variants):
--   authenticated SELECT: USING (true)
--   authenticated ALL:    USING (true) WITH CHECK (true)
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE b2b_catalog_materials_v2        ENABLE ROW LEVEL SECURITY;
ALTER TABLE b2b_catalog_material_variants_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE b2b_catalog_material_prices_v2  ENABLE ROW LEVEL SECURITY;
ALTER TABLE b2b_catalog_services_v2         ENABLE ROW LEVEL SECURITY;
ALTER TABLE b2b_catalog_service_prices_v2   ENABLE ROW LEVEL SECURITY;
ALTER TABLE b2b_catalog_constants_v2        ENABLE ROW LEVEL SECURITY;

-- b2b_catalog_materials_v2
CREATE POLICY "Auth read b2b_catalog_materials_v2"
  ON b2b_catalog_materials_v2 FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth manage b2b_catalog_materials_v2"
  ON b2b_catalog_materials_v2 FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- b2b_catalog_material_variants_v2
CREATE POLICY "Auth read b2b_catalog_material_variants_v2"
  ON b2b_catalog_material_variants_v2 FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth manage b2b_catalog_material_variants_v2"
  ON b2b_catalog_material_variants_v2 FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- b2b_catalog_material_prices_v2
CREATE POLICY "Auth read b2b_catalog_material_prices_v2"
  ON b2b_catalog_material_prices_v2 FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth manage b2b_catalog_material_prices_v2"
  ON b2b_catalog_material_prices_v2 FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- b2b_catalog_services_v2
CREATE POLICY "Auth read b2b_catalog_services_v2"
  ON b2b_catalog_services_v2 FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth manage b2b_catalog_services_v2"
  ON b2b_catalog_services_v2 FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- b2b_catalog_service_prices_v2
CREATE POLICY "Auth read b2b_catalog_service_prices_v2"
  ON b2b_catalog_service_prices_v2 FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth manage b2b_catalog_service_prices_v2"
  ON b2b_catalog_service_prices_v2 FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- b2b_catalog_constants_v2
CREATE POLICY "Auth read b2b_catalog_constants_v2"
  ON b2b_catalog_constants_v2 FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth manage b2b_catalog_constants_v2"
  ON b2b_catalog_constants_v2 FOR ALL TO authenticated USING (true) WITH CHECK (true);
