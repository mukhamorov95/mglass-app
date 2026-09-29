-- Кадр, отправленный пакетом в Anthropic, ждёт результата часами. Без отдельного статуса
-- повторный запуск отправил бы его второй раз — и разбор оплачивался бы дважды.
alter table montage_media drop constraint if exists montage_media_class_status_check;
alter table montage_media add constraint montage_media_class_status_check
  check (class_status in ('none', 'queued', 'done', 'failed'));
alter table montage_media add column if not exists class_batch text;  -- id пакета Anthropic
