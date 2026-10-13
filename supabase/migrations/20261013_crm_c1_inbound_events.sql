-- С1 маршрута розничной CRM (docs/B2C_CRM_ROUTE.md): приём без потерь.
-- inbound_events — сырой журнал каждого вызова вебхука до разбора: если разбор
-- упал или поменялась схема, пакет остаётся здесь и его можно разобрать заново.
-- Читают только серверные маршруты под service-role; политик для ролей нет намеренно.

create table if not exists public.inbound_events (
  id           bigserial primary key,
  provider     text not null,
  received_at  timestamptz not null default now(),
  payload      jsonb not null,
  status       text not null default 'received' check (status in ('received', 'processed', 'failed')),
  error        text,
  processed_at timestamptz
);

create index if not exists inbound_events_provider_received_idx
  on public.inbound_events (provider, received_at desc);
create index if not exists inbound_events_not_processed_idx
  on public.inbound_events (received_at) where status <> 'processed';

alter table public.inbound_events enable row level security;
-- В пакетах телефоны и тексты клиентов: права ролей входа снимаем совсем, не только RLS.
revoke all on public.inbound_events from anon, authenticated;
revoke all on sequence public.inbound_events_id_seq from anon, authenticated;

-- Решение владельца 13.10: тексты ответов менеджеров храним (раньше — только автор).
alter table public.wazzup_outgoing_messages
  add column if not exists text        text,
  add column if not exists content_uri text;
