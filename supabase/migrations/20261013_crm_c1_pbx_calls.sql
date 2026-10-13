-- С1 маршрута розничной CRM (docs/B2C_CRM_ROUTE.md): все звонки АТС, а не только те,
-- что дошли вебхуком (он стоит на входящей схеме и ловил около четверти звонков).
-- Пополняет крон /api/cron/pbx-calls-sync из API OnlinePBX. Запись разговора остаётся
-- в АТС: храним uuid, по нему запись запрашивается у АТС.

create table if not exists public.pbx_calls (
  uuid         text primary key,
  started_at   timestamptz not null,
  direction    text not null check (direction in ('in', 'out', 'local')),
  client_phone text,
  ext          text,
  talk_sec     integer not null default 0,
  duration_sec integer,
  answered     boolean not null default false,
  hangup_cause text,
  raw          jsonb not null,
  fetched_at   timestamptz not null default now()
);

create index if not exists pbx_calls_started_idx on public.pbx_calls (started_at desc);
create index if not exists pbx_calls_client_idx on public.pbx_calls (client_phone, started_at desc);

alter table public.pbx_calls enable row level security;
-- Телефоны клиентов: только серверные маршруты под service-role.
revoke all on public.pbx_calls from anon, authenticated;
