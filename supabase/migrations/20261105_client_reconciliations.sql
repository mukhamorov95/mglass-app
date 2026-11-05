-- Акт сверки с клиентом (владелец 05.11.2026): сохранённые документы за период.
-- В snapshot расчёт на момент сохранения: документ не меняется, когда позже меняются заказы и оплаты.
-- RLS без политик: читает и пишет только маршрут /api/production/client-reconciliation после проверки права на деньги.

create table if not exists public.client_reconciliations (
  id              serial primary key,
  client_id       bigint not null references public.b2b_clients(id),
  date_from       date not null,
  date_to         date not null,
  snapshot        jsonb not null,
  created_by      uuid references auth.users(id),
  created_by_name text,
  created_at      timestamptz not null default now(),
  check (date_from <= date_to)
);

create index if not exists client_reconciliations_client_idx on public.client_reconciliations (client_id, created_at desc);

alter table public.client_reconciliations enable row level security;
revoke all on public.client_reconciliations from anon, authenticated;
