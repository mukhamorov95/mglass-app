-- ═══════════════════════════════════════════════════════════════════
-- Расширение таблицы shower_catalog_items:
-- добавляем колонки, которые используются в CatalogTab.tsx
-- но отсутствовали в исходной миграции (20250508_vetro_hardware_seed).
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE public.shower_catalog_items
  ADD COLUMN IF NOT EXISTS hinge_type         text
    CHECK (hinge_type IN ('wall-glass', 'glass-glass')),

  ADD COLUMN IF NOT EXISTS track_type         text
    CHECK (track_type IN ('open', 'closed')),

  ADD COLUMN IF NOT EXISTS item_role          text        NOT NULL DEFAULT 'optional'
    CHECK (item_role IN ('required', 'optional', 'addon')),

  ADD COLUMN IF NOT EXISTS depends_on_item_id bigint
    REFERENCES public.shower_catalog_items(id) ON DELETE SET NULL,

  ADD COLUMN IF NOT EXISTS sort_order         int         NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS min_qty            int         NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS max_qty            int,
  ADD COLUMN IF NOT EXISTS lead_days          int,
  ADD COLUMN IF NOT EXISTS stock_qty          int         NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS subcategory        text;

-- Индекс для быстрой фильтрации по типу петель и треку (используется в калькуляторе)
CREATE INDEX IF NOT EXISTS idx_shower_catalog_items_hinge_type
  ON public.shower_catalog_items (hinge_type) WHERE hinge_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shower_catalog_items_track_type
  ON public.shower_catalog_items (track_type) WHERE track_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shower_catalog_items_item_role
  ON public.shower_catalog_items (item_role);
