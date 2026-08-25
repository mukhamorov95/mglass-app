-- A17: гарантия и сервис — заявки на рекламацию из кабинета партнёра.
-- Партнёр описывает дефект по своему заказу, менеджер ведёт статус. Читают строго
-- свои (первичный владелец ИЛИ участник команды), мутации — только service-role (API).

create table if not exists partner_claims (
  id          bigserial primary key,
  client_id   bigint not null references b2b_clients(id) on delete cascade,
  order_id    bigint references b2b_orders(id) on delete set null,
  kind        text not null,                       -- boy | skol | mismatch | hardware | other
  description text not null,
  photo_url   text,
  status      text not null default 'open',        -- open | in_review | resolved | rejected
  resolution  text,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  created_by  uuid
);
create index if not exists partner_claims_client_idx on partner_claims (client_id, created_at desc);

alter table partner_claims enable row level security;
drop policy if exists partner_claims_select_own on partner_claims;
create policy partner_claims_select_own on partner_claims
  for select using (
    client_id in (select id from b2b_clients where user_id = auth.uid())
    or client_id in (select client_id from b2b_client_members where user_id = auth.uid())
  );
