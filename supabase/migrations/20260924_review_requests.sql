-- Очередь просьб об отзыве. Отдельная таблица, а не поле в crm_sales: одному клиенту
-- можно написать повторно по другому заказу, а история отправок нужна целиком —
-- иначе после сбоя не видно, кому уже писали, и человек получает просьбу дважды.
create table if not exists review_requests (
  id uuid primary key default gen_random_uuid(),
  amo_lead_id bigint,
  client_name text,
  phone text not null,
  order_title text,
  amount numeric,
  done_at date,                       -- когда сдали объект: от него зависит текст
  channel_id text,                    -- канал Wazzup, с которого пишем
  chat_id text,
  message_text text,
  status text not null default 'pending'
    check (status in ('pending','sent','failed','skipped','replied','review_left')),
  error text,
  sent_at timestamptz,
  replied_at timestamptz,
  discount_note text,                 -- чем подтверждаем обещанные 15%
  created_at timestamptz not null default now()
);

-- Один и тот же телефон по одной и той же сделке не ставим в очередь дважды:
-- наполнение очереди запускается повторно и обязано быть идемпотентным.
create unique index if not exists review_requests_unique_lead
  on review_requests (phone, coalesce(amo_lead_id, 0));

create index if not exists review_requests_status on review_requests (status, created_at);

alter table review_requests enable row level security;

-- В строках телефон и имя клиента — читает только владелец.
create policy review_requests_owner_read on review_requests
  for select to authenticated using (is_owner());
