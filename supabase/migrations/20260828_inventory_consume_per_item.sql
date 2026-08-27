-- Подетальное списание при закрытии резки (решение владельца 27.08.2026).
--
-- Материал физически уходит на резке, не на упаковке. Списываем подетально при
-- закрытии cutting-задачи (order_id, item_index) — самое живое событие цеха
-- (834 живых отметки из 867, 96%). Количество плановое (площадь из заказа).
--
-- Развилка по данным, НЕ замена триггера:
--   • заказ через цех (есть cutting-задачи) → подетально на резке;
--   • заказ мимо цеха (задач нет) → весь план при упаковке, как раньше.

ALTER TABLE public.inventory_moves
  ADD COLUMN IF NOT EXISTS item_index integer,             -- индекс позиции в b2b_orders.items
  ADD COLUMN IF NOT EXISTS stage      text,                -- этап-источник ('cutting')
  ADD COLUMN IF NOT EXISTS attempt    integer NOT NULL DEFAULT 0;  -- номер попытки = production_tasks.rework_count

-- Старый ключ идемпотентности — ТОЛЬКО для заказ-уровневых движений (упаковочный
-- fallback + приход): item_index IS NULL. Иначе он блокировал бы несколько
-- позиций одного материала в заказе (3 сатиновые створки → одна складская позиция).
DROP INDEX IF EXISTS public.inventory_moves_doc_item_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS inventory_moves_doc_item_uniq
  ON public.inventory_moves (doc_type, doc_id, item_id, reason)
  WHERE doc_type IS NOT NULL AND reason IN ('order','production','purchase') AND item_index IS NULL;

-- Подетальное списание идемпотентно по (заказ, позиция, СКЛАДСКАЯ-ПОЗИЦИЯ, этап,
-- ПОПЫТКА).
--   • Попытка обязательна: переделка (rework_count растёт) = новый лист = второе
--     списание физически верно; ключ без попытки дал бы систематический недоучёт.
--   • item_id обязателен: одна позиция заказа может расходовать НЕСКОЛЬКО складских
--     материалов (стекло + плёнка, стекло + фурнитура). Без item_id второе движение
--     упёрлось бы в индекс и потерялось. Сейчас consumeItemAtStage списывает один
--     материал на позицию, но индекс не должен быть тем, что молча ломает BOM-позицию.
--   • reason='order' — чтобы встречные коррекции (откат мисклика, reason<>order) не
--     конфликтовали с исходным списанием.
DROP INDEX IF EXISTS public.inventory_moves_doc_itemidx_stage_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS inventory_moves_doc_itemidx_stage_uniq
  ON public.inventory_moves (doc_type, doc_id, item_index, item_id, stage, attempt)
  WHERE item_index IS NOT NULL AND stage IS NOT NULL AND reason = 'order';
