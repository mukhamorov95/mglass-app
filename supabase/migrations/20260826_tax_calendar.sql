-- Б12: налоговый календарь. Сроки платежей знал только бухгалтер в голове.
-- Строка — обязательство: что, за какой период, когда крайний срок, сколько.
-- Оплата рождает операцию ДДС в фонде «Налоги» и связывается с ней.
create table if not exists tax_calendar (
  id          bigserial primary key,
  unit        text not null check (unit in ('ip','ooo')),
  kind        text not null check (kind in ('УСН','патент','взносы','НДС','НДФЛ','прочее')),
  title       text not null,
  period      text,                       -- «3 квартал 2026», «август 2026»
  due_date    date not null,
  amount      numeric(14,2),              -- null = сумма ещё не посчитана
  status      text not null default 'planned' check (status in ('planned','paid','cancelled')),
  entry_id    bigint references cashflow_entries(id),
  note        text,
  created_by_name text,
  created_at  timestamptz not null default now(),
  unique (unit, kind, period, due_date)
);
create index if not exists idx_tax_due on tax_calendar (unit, status, due_date);

alter table tax_calendar enable row level security;
create policy tax_select on tax_calendar for select to authenticated using (
  exists (select 1 from crm_caller() c where c.u_role in ('accountant','cfo','admin','ceo'))
);
