-- Каскад этапов: мастер отмечает свой этап (Никита — закалка/упаковка), а все
-- предыдущие этапы этой детали закрываются автоматически — физически они уже
-- сделаны (нельзя закалить нерезаное, упаковать несверлёное). Флаг отделяет
-- авто-закрытие от живой отметки мастера, чтобы метрики цеха не врали.
alter table production_tasks add column if not exists auto_closed boolean not null default false;

-- Каскад ищет предыдущие этапы той же детали — индекс под этот запрос.
create index if not exists production_tasks_item_seq_idx
  on production_tasks (order_id, item_index, sequence_order);
