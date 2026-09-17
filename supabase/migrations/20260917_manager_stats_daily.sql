-- Показатели менеджеров по дням из управленческой таблицы владельца
-- («Аналитика дохода»): разговоры, замеры, оплаты и полученные деньги.
--
-- Почему отдельной таблицей, а не считаем из своих данных: разговоры и замеры
-- ведутся в amoCRM и в самой таблице, наша база их полностью не знает. Пока не
-- знает — источником остаётся книга, но лежать цифры должны у нас: по ним нужен
-- любой период и разрез по менеджеру, а не только те месяцы, что открыты в листе.
--
-- Ключ — день + менеджер + показатель: повторный импорт обновляет, а не множит.

create table if not exists public.manager_stats_daily (
  stat_date  date    not null,
  manager    text    not null,
  metric     text    not null,
  value      numeric not null,
  source     text    not null default 'gsheet_mgmt',
  updated_at timestamptz not null default now(),
  primary key (stat_date, manager, metric)
);

create index if not exists manager_stats_daily_date_idx on public.manager_stats_daily (stat_date);
create index if not exists manager_stats_daily_manager_idx on public.manager_stats_daily (manager);

alter table public.manager_stats_daily enable row level security;

-- Читает персонал; партнёру внутренняя статистика не видна. Пишет только
-- service-role (скрипт импорта), поэтому политики на запись нет.
drop policy if exists manager_stats_daily_read on public.manager_stats_daily;
create policy manager_stats_daily_read on public.manager_stats_daily
  for select using (not is_partner());

comment on table public.manager_stats_daily is
  'Показатели менеджеров по дням из книги «Управленческая таблица M-Glass», лист «Аналитика дохода». Обновляется scripts/import-manager-stats.mjs.';
