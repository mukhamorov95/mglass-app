-- Журнал запусков кронов (AI Control Center, этап 1б, 06.10.2026). По строке на крон:
-- последний старт, последний успех, последняя ошибка. Пишет и читает только сервер.
create table if not exists cron_runs (
  job             text primary key,
  last_started_at timestamptz,
  last_ok_at      timestamptz,
  last_error      text,
  last_error_at   timestamptz,
  last_ms         integer,
  updated_at      timestamptz not null default now()
);

alter table cron_runs enable row level security;
-- Политик нет намеренно: service role их обходит, остальным — ничего.
revoke all on cron_runs from anon, authenticated;
