-- A6 «просто»: несколько логинов на одну компанию-заказчика (все участники равны).
-- b2b_clients.user_id остаётся «первичным» владельцем (обратная совместимость),
-- дополнительные сотрудники — строки b2b_client_members. UNIQUE(user_id) гарантирует
-- изоляцию: один логин принадлежит РОВНО одной компании (не может видеть две).

create table if not exists b2b_client_members (
  id          bigserial primary key,
  client_id   bigint not null references b2b_clients(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  created_by  uuid,
  unique (user_id)
);
create index if not exists b2b_client_members_client_idx on b2b_client_members (client_id);

alter table b2b_client_members enable row level security;
-- Мутации — только service-role (админ-API). Партнёр видит лишь своё членство.
drop policy if exists b2b_client_members_self on b2b_client_members;
create policy b2b_client_members_self on b2b_client_members
  for select using (user_id = auth.uid());

-- Уведомления кабинета видят и участники команды (не только первичный владелец).
drop policy if exists partner_notifications_select_own on partner_notifications;
create policy partner_notifications_select_own on partner_notifications
  for select using (
    client_id in (select id from b2b_clients where user_id = auth.uid())
    or client_id in (select client_id from b2b_client_members where user_id = auth.uid())
  );
