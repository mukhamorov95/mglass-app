-- Уведомления кабинета партнёра (колокольчик + запись для e-mail).
-- Пишет только service-role (API/крон), партнёр читает строго свои (RLS по b2b_clients.user_id).
-- Идемпотентность транзиций статуса заказа хранится в b2b_orders.notes.partner_notified_lane
-- (не здесь) — эта таблица лишь лог доставленных партнёру событий.

create table if not exists partner_notifications (
  id          bigserial primary key,
  client_id   bigint not null references b2b_clients(id) on delete cascade,
  order_id    bigint references b2b_orders(id) on delete cascade,
  kind        text not null,                 -- access | submitted | in_work | ready | shipped | recalc
  title       text not null,
  body        text,
  link        text,
  read_at     timestamptz,
  emailed_at  timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists partner_notifications_client_idx
  on partner_notifications (client_id, created_at desc);

-- Дедуп события по заказу+типу (одно «принят в работу» на заказ).
create unique index if not exists partner_notifications_dedup_idx
  on partner_notifications (client_id, order_id, kind)
  where order_id is not null;

alter table partner_notifications enable row level security;

-- Партнёр видит только свои уведомления. Мутации — только service-role (политик на них нет).
drop policy if exists partner_notifications_select_own on partner_notifications;
create policy partner_notifications_select_own on partner_notifications
  for select
  using (client_id in (select id from b2b_clients where user_id = auth.uid()));
