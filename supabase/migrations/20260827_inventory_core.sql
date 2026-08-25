-- Складской контур: единый реестр позиций + журнал движений.
--
-- Зачем: до этого «остаток» жил тремя разными полями в трёх справочниках
-- (materials.stock_qty, shower_catalog_items.stock_qty, b2b_materials.stock_sheets),
-- ни одно не подтверждалось историей и все были нулевые. Теперь остаток —
-- ПРОИЗВОДНАЯ от журнала движений, а не редактируемое поле.
--
-- Единицы: у позиции есть БАЗОВАЯ единица (м² / шт / м.п.) и необязательная ТАРА
-- (лист / хлыст / упаковка) с коэффициентом. Человек вводит листы — база хранит м².

CREATE TABLE IF NOT EXISTS public.inventory_items (
  id            bigserial PRIMARY KEY,
  contour       text NOT NULL DEFAULT 'b2c' CHECK (contour IN ('b2b','b2c','both')),
  kind          text NOT NULL DEFAULT 'other'
                CHECK (kind IN ('glass','mirror','hardware','profile','seal','led','consumable','packaging','other')),
  name          text NOT NULL,
  article       text NOT NULL DEFAULT '',
  unit          text NOT NULL DEFAULT 'шт' CHECK (unit IN ('м2','шт','м.п.','кг','л','компл')),

  -- Тара: как позицию считают руками. pack_size — сколько базовых единиц в одной таре.
  pack_label    text,
  pack_size     numeric NOT NULL DEFAULT 0 CHECK (pack_size >= 0),

  -- Ссылка на справочник-источник: имя/цену не дублируем, тянем оттуда.
  ref_table     text CHECK (ref_table IN ('b2b_materials','shower_catalog_items','materials','configurator_library')),
  ref_id        text,

  supplier_id   uuid,
  color         text,
  thickness     numeric,
  location      text NOT NULL DEFAULT '',

  min_qty       numeric NOT NULL DEFAULT 0,   -- ниже — дефицит
  target_qty    numeric NOT NULL DEFAULT 0,   -- норма, до которой дозакупают

  qty           numeric NOT NULL DEFAULT 0,   -- кэш: сумма движений, ведёт триггер
  qty_reserved  numeric NOT NULL DEFAULT 0,   -- зарезервировано под запущенные заказы
  avg_cost      numeric NOT NULL DEFAULT 0,   -- скользящая средняя себестоимость за базовую единицу

  bom_aliases   text[] NOT NULL DEFAULT '{}', -- как позиция называется в BOM заказов (для авто-списания)
  active        boolean NOT NULL DEFAULT true,
  notes         text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_ref_uniq
  ON public.inventory_items (ref_table, ref_id) WHERE ref_table IS NOT NULL;
CREATE INDEX IF NOT EXISTS inventory_items_contour_idx ON public.inventory_items (contour, kind) WHERE active;
CREATE INDEX IF NOT EXISTS inventory_items_name_idx    ON public.inventory_items (lower(name));

CREATE TABLE IF NOT EXISTS public.inventory_moves (
  id            bigserial PRIMARY KEY,
  item_id       bigint NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  qty           numeric NOT NULL CHECK (qty <> 0),   -- со знаком, в базовой единице
  pack_qty      numeric,                             -- сколько тары ввели (справочно, для журнала)
  reason        text NOT NULL DEFAULT 'manual'
                CHECK (reason IN ('purchase','return','order','production','writeoff','defect','count','init','manual','transfer')),
  unit_cost     numeric NOT NULL DEFAULT 0,          -- цена за базовую единицу (для приходов)
  doc_type      text CHECK (doc_type IN ('purchase_order','b2b_order','order','shop_request')),
  doc_id        text,
  note          text NOT NULL DEFAULT '',
  created_by    uuid,
  created_by_name text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inventory_moves_item_idx ON public.inventory_moves (item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS inventory_moves_doc_idx  ON public.inventory_moves (doc_type, doc_id) WHERE doc_type IS NOT NULL;

-- Идемпотентность: один документ списывает одну позицию ровно один раз.
CREATE UNIQUE INDEX IF NOT EXISTS inventory_moves_doc_item_uniq
  ON public.inventory_moves (doc_type, doc_id, item_id, reason)
  WHERE doc_type IS NOT NULL AND reason IN ('order','production','purchase');

-- ─── Остаток и средняя себестоимость ведёт триггер ───────────────────────────

CREATE OR REPLACE FUNCTION public.inventory_apply_move() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  cur_qty  numeric;
  cur_cost numeric;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT qty, avg_cost INTO cur_qty, cur_cost FROM inventory_items WHERE id = NEW.item_id FOR UPDATE;

    -- Приход с ценой двигает среднюю; расход её не трогает.
    IF NEW.qty > 0 AND NEW.unit_cost > 0 THEN
      IF cur_qty + NEW.qty > 0 THEN
        cur_cost := (GREATEST(cur_qty, 0) * cur_cost + NEW.qty * NEW.unit_cost) / (GREATEST(cur_qty, 0) + NEW.qty);
      ELSE
        cur_cost := NEW.unit_cost;
      END IF;
    END IF;

    UPDATE inventory_items
       SET qty = cur_qty + NEW.qty, avg_cost = cur_cost, updated_at = now()
     WHERE id = NEW.item_id;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    UPDATE inventory_items
       SET qty = qty - OLD.qty, updated_at = now()
     WHERE id = OLD.item_id;
    RETURN OLD;
  END IF;

  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS inventory_moves_apply ON public.inventory_moves;
CREATE TRIGGER inventory_moves_apply
  AFTER INSERT OR DELETE ON public.inventory_moves
  FOR EACH ROW EXECUTE FUNCTION public.inventory_apply_move();

-- Журнал неизменяем: исправление — только встречным движением.
CREATE OR REPLACE FUNCTION public.inventory_moves_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'inventory_moves: запись журнала нельзя менять, добавьте корректирующее движение';
END $$;

DROP TRIGGER IF EXISTS inventory_moves_no_update ON public.inventory_moves;
CREATE TRIGGER inventory_moves_no_update
  BEFORE UPDATE ON public.inventory_moves
  FOR EACH ROW EXECUTE FUNCTION public.inventory_moves_immutable();

-- Пересчёт остатков из журнала (страховка при ручных правках в БД).
CREATE OR REPLACE FUNCTION public.inventory_recalc(p_item_id bigint DEFAULT NULL) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE inventory_items i
     SET qty = COALESCE((SELECT sum(m.qty) FROM inventory_moves m WHERE m.item_id = i.id), 0),
         updated_at = now()
   WHERE p_item_id IS NULL OR i.id = p_item_id;
$$;

-- RLS: браузер к складу напрямую не ходит — только через /api/inventory/*
-- (себестоимость и средняя цена наружу не отдаются). Политик намеренно нет:
-- без политик RLS не пускает никого, кроме service_role (BYPASSRLS).
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_moves ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON FUNCTION public.inventory_recalc(bigint) FROM anon, authenticated;
