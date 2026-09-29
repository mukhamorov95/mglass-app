-- Архив «Монтажей» приходит двумя путями: бот ловит новое, экспорт из Telegram Desktop
-- приносит историю с 2022 года. Одна таблица на оба — иначе раскладка не возобновляется
-- после падения, а кадр, пойманный ботом и попавший в экспорт, ложится на Диск дважды.

-- У кадра из экспорта нет file_id Bot API: он лежит файлом в папке экспорта.
alter table montage_media alter column tg_file_id     drop not null;
alter table montage_media alter column tg_file_unique drop not null;

alter table montage_media add column if not exists source text not null default 'bot';
alter table montage_media drop constraint if exists montage_media_source_check;
alter table montage_media add constraint montage_media_source_check check (source in ('bot', 'export'));

alter table montage_media add column if not exists export_path text;  -- путь внутри папки экспорта
alter table montage_media add column if not exists disk_path   text;  -- куда легло на Яндекс.Диске

-- Одно сообщение Telegram = один кадр (альбом — это несколько сообщений). По этой паре
-- экспорт узнаёт кадры, которые бот уже поймал, и не заводит их второй раз.
create unique index if not exists montage_media_chat_message
  on montage_media (tg_chat_id, tg_message_id);

create index if not exists montage_media_pipeline
  on montage_media (class_status, kind) where disk_path is null;
