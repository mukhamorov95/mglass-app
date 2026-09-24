-- Архив монтажей из группы Telegram «Монтажи»: 6 766 фото и 1 094 видео — единственный
-- систематический след готовых объектов (в orders одна строка, в installations три).
-- Из него растут портфолио сайта, фото на посадочные и лента для соцсетей.
--
-- Приём разведён на два шага нарочно: вебхук только записывает строку (Telegram ждёт
-- ответ секунды), а файл забирает крон /api/cron/montage-media-fetch. Иначе большое
-- видео роняет вебхук и Telegram начинает слать обновление заново.
--
-- caption_raw хранится ради номера заказа, но в нём же едут адрес, квартира, телефон
-- клиента и суммы наличных. Наружу подпись не выходит никогда: read — только владельцу,
-- на сайт уезжает кадр с нашим текстом. Отсюда RLS без политик для остальных ролей.

create table if not exists montage_media (
  id              uuid primary key default gen_random_uuid(),

  tg_chat_id      bigint not null,
  tg_chat_title   text,
  tg_message_id   bigint not null,
  tg_media_group  text,                       -- альбом: несколько файлов одним сообщением
  tg_file_id      text   not null,            -- живёт, пока жив бот; по нему качаем
  tg_file_unique  text   not null,            -- один и тот же файл в двух сообщениях = один ряд
  kind            text   not null check (kind in ('photo','video')),

  sender          text,
  caption_raw     text,
  order_number    text,                       -- «#0875-2» из подписи, если он там был
  taken_at        timestamptz not null,       -- дата сообщения, не дата загрузки

  width           int,
  height          int,
  duration        int,
  file_size       bigint,

  storage_path    text,                       -- путь в бакете montage-media
  fetch_status    text not null default 'pending'
                  check (fetch_status in ('pending','stored','too_big','failed')),
  fetch_error     text,
  fetched_at      timestamptz,

  -- что модель увидела на кадре: тип изделия, геометрия, трек, стоп-признаки
  classification  jsonb,
  class_status    text not null default 'none' check (class_status in ('none','done','failed')),

  -- решение человека: куда кадр пойдёт
  review          text not null default 'new'
                  check (review in ('new','portfolio','social','rejected','private')),

  created_at      timestamptz not null default now()
);

create unique index if not exists montage_media_unique_file on montage_media (tg_file_unique);
create index if not exists montage_media_fetch  on montage_media (fetch_status) where fetch_status = 'pending';
create index if not exists montage_media_class  on montage_media (class_status) where class_status = 'none';
create index if not exists montage_media_taken  on montage_media (taken_at desc);
create index if not exists montage_media_order  on montage_media (order_number) where order_number is not null;
create index if not exists montage_media_review on montage_media (review);

alter table montage_media enable row level security;

-- Политика ровно одна и только на чтение: пишет сервис-роль из вебхука и крона,
-- она RLS не проверяет. У anon и authenticated без политики — пусто, и это намеренно.
drop policy if exists montage_media_owner_read on montage_media;
create policy montage_media_owner_read on montage_media
  for select to authenticated
  using (is_owner());
