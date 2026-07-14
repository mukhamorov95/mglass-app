-- Связь заявки на закупку с заказом/позицией: статус закупки (need→ordered→arrived)
-- виден в «Нужен материал» и в очереди мастера. item_index NULL = весь заказ.
ALTER TABLE public.shop_purchase_requests
  ADD COLUMN IF NOT EXISTS b2b_order_id bigint REFERENCES public.b2b_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS item_index int;

CREATE INDEX IF NOT EXISTS spr_order_idx
  ON public.shop_purchase_requests(b2b_order_id) WHERE b2b_order_id IS NOT NULL;
