-- Триплекс в производстве: задачи ПО СЛОЯМ пакета.
-- Каждое стекло (напр. 4 мм и 6 мм) идёт своей цепочкой резка→полировка→сверловка→закалка,
-- склейка (triplex) и упаковка — на изделие целиком (layer = 0).
-- Обычные позиции: все задачи layer = 1 (как раньше) — существующие данные не меняются.

ALTER TABLE public.production_tasks
  ADD COLUMN IF NOT EXISTS layer int NOT NULL DEFAULT 1;
ALTER TABLE public.production_tasks
  ADD COLUMN IF NOT EXISTS layer_note text;

COMMENT ON COLUMN public.production_tasks.layer IS
  '0 = изделие целиком (склейка/упаковка триплекса); 1..N = слой пакета (стекло). Обычные позиции — 1.';
COMMENT ON COLUMN public.production_tasks.layer_note IS
  'Подпись слоя для рабочего, напр. «слой 2: 4 мм».';

ALTER TABLE public.production_tasks DROP CONSTRAINT IF EXISTS pt_unique_item_stage;
ALTER TABLE public.production_tasks
  ADD CONSTRAINT pt_unique_item_stage_layer UNIQUE (order_id, item_index, stage_key, layer);
