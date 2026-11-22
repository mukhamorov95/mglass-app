-- ФП Ф5 (docs/finplan/FINPLAN_ROUTE.md): утверждённое распределение денег недели по
-- фондам. Одна строка на неделю — повторное «Утвердить» не создаёт второй результат;
-- менять и удалять нельзя (политик на update/delete нет).
create table if not exists public.fp_distributions (
  id          bigserial primary key,
  unit        text not null check (unit in ('ip','ooo')),
  week_end    date not null,
  income      numeric(14,2) not null,
  result      jsonb not null,
  approved_by text,
  approved_at timestamptz not null default now(),
  unique (unit, week_end)
);
alter table public.fp_distributions enable row level security;

drop policy if exists fp_dist_select on public.fp_distributions;
create policy fp_dist_select on public.fp_distributions for select to authenticated using (
  exists (select 1 from crm_caller() c where c.u_role in ('accountant','cfo','admin','ceo'))
);
drop policy if exists fp_dist_insert on public.fp_distributions;
create policy fp_dist_insert on public.fp_distributions for insert to authenticated with check (
  exists (select 1 from crm_caller() c where c.u_role in ('cfo','admin','ceo'))
);
drop trigger if exists audit_change on public.fp_distributions;
create trigger audit_change after insert or delete or update on public.fp_distributions
  for each row execute function audit_change('unit,week_end', '', '');
