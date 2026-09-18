-- Итоги месяца из управленческой книги — рядом с дневными фактами.
--
-- Владелец читает книгу по колонке итога месяца (август 26 — колонка ADL), а
-- первый импорт складывал дни. В 31 случае из 27 месяцев это не одно и то же:
--   • сумма внесена только в итог месяца, без дня (Дима в феврале, марте и
--     июне 2026, разговоры Семёна) — итог больше дней, прав итог;
--   • формула итога не захватывает 31-е число (май и июль 2025) — итог меньше
--     дней ровно на значение 31-го, правы дни.
-- Поэтому храним обе цифры и решение: book — что в книге, days — сумма дней,
-- value — что показываем, kind — почему.

create table if not exists public.manager_stats_monthly (
  month      text    not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  manager    text    not null,
  metric     text    not null,
  book       numeric,
  days       numeric not null default 0,
  value      numeric not null,
  kind       text    not null check (kind in ('match', 'month_only', 'total_misses_last_day', 'total_below_days', 'no_total')),
  delta      numeric not null default 0,
  note_day   date,
  updated_at timestamptz not null default now(),
  primary key (month, manager, metric)
);

alter table public.manager_stats_monthly enable row level security;

drop policy if exists manager_stats_monthly_read on public.manager_stats_monthly;
create policy manager_stats_monthly_read on public.manager_stats_monthly
  for select using (not is_partner());

comment on table public.manager_stats_monthly is
  'Итоги месяца из книги «Управленческая таблица M-Glass» и их сверка с суммой дней. Обновляется scripts/import-manager-stats.mjs.';
