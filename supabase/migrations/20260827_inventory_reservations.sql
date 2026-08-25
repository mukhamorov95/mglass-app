-- С4: резерв материала под запущенный заказ. Резерв ≠ расход: остаток qty не
-- трогается, двигается только qty_reserved, доступное = qty − qty_reserved.
-- Списание в цех остаётся отдельным движением (reason='order') по кнопке.

CREATE TABLE IF NOT EXISTS public.inventory_reservations (
  id         bigserial PRIMARY KEY,
  item_id    bigint NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  qty        numeric NOT NULL CHECK (qty > 0),   -- в базовой единице позиции
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active','released','consumed')),
  doc_type   text NOT NULL CHECK (doc_type IN ('b2b_order','order')),
  doc_id     text NOT NULL,
  note       text NOT NULL DEFAULT '',
  created_by uuid,
  created_by_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz
);

CREATE INDEX IF NOT EXISTS inventory_reservations_item_idx ON public.inventory_reservations (item_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS inventory_reservations_doc_idx  ON public.inventory_reservations (doc_type, doc_id);

-- Один заказ резервирует одну позицию ровно один раз (идемпотентность запуска).
CREATE UNIQUE INDEX IF NOT EXISTS inventory_reservations_doc_item_uniq
  ON public.inventory_reservations (doc_type, doc_id, item_id) WHERE status = 'active';

-- qty_reserved на карточке = Σ активных резервов. Ведёт триггер.
CREATE OR REPLACE FUNCTION public.inventory_apply_reservation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target bigint;
BEGIN
  target := COALESCE(NEW.item_id, OLD.item_id);
  UPDATE inventory_items i
     SET qty_reserved = COALESCE((
           SELECT sum(r.qty) FROM inventory_reservations r
            WHERE r.item_id = target AND r.status = 'active'), 0),
         updated_at = now()
   WHERE i.id = target;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS inventory_reservations_apply ON public.inventory_reservations;
CREATE TRIGGER inventory_reservations_apply
  AFTER INSERT OR UPDATE OR DELETE ON public.inventory_reservations
  FOR EACH ROW EXECUTE FUNCTION public.inventory_apply_reservation();

ALTER TABLE public.inventory_reservations ENABLE ROW LEVEL SECURITY;
