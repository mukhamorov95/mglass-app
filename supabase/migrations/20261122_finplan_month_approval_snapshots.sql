-- ФП Ф2 (docs/finplan/FINPLAN_ROUTE.md): утверждённый план поступлений месяца
-- с разбивкой по периодам (недели по средам + «До конца месяца») и снимок
-- каждой контрольной даты.

alter table public.cashflow_month_plans
  add column if not exists periods jsonb,              -- [{start,end,amount}] — разбивка, рубли с копейками
  add column if not exists revenue_target numeric(14,2), -- цель по выручке (ТБ) — для пояснения разницы с планом денег
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by text;

-- Утвердить можно только разбивку, сходящуюся с месяцем до копейки.
create or replace function public.cashflow_month_plan_check() returns trigger
language plpgsql set search_path = public as $$
declare s numeric;
begin
  if new.periods is not null and jsonb_typeof(new.periods) <> 'array' then
    raise exception 'periods должен быть массивом';
  end if;
  if new.approved_at is not null then
    if new.periods is null or jsonb_array_length(new.periods) = 0 then
      raise exception 'Нельзя утвердить план без разбивки по периодам';
    end if;
    select coalesce(sum(round((p->>'amount')::numeric * 100)), 0) into s from jsonb_array_elements(new.periods) p;
    if s <> round(new.plan_amount * 100) then
      raise exception 'Разбивка (% ₽) не сходится с планом месяца (% ₽)', (s / 100)::numeric(14,2), new.plan_amount;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists cashflow_month_plan_check on public.cashflow_month_plans;
create trigger cashflow_month_plan_check before insert or update on public.cashflow_month_plans
  for each row execute function public.cashflow_month_plan_check();

drop trigger if exists audit_change on public.cashflow_month_plans;
create trigger audit_change after insert or delete or update on public.cashflow_month_plans
  for each row execute function audit_change('unit,month', '', '');

-- Снимок контрольной даты: что было известно в момент закрытия периода.
-- Пишет только крон /api/cron/finplan-snapshot (service role); читает финконтур.
create table if not exists public.cashflow_period_snapshots (
  id             bigserial primary key,
  unit           text not null check (unit in ('ip','ooo')),
  month          text not null check (month ~ '^\d{4}-\d{2}$'),
  period_start   date not null,
  period_end     date not null,
  tail           boolean not null default false,
  month_plan     numeric(14,2) not null,
  approved       boolean not null,
  base_period    numeric(14,2) not null,  -- исходный план периода
  plan_period    numeric(14,2) not null,  -- цель периода после пересмотров
  fact_period    numeric(14,2) not null,  -- деньги клиентов за даты периода
  non_income_period numeric(14,2) not null default 0,
  cum_base       numeric(14,2) not null,  -- по исходному плану с начала месяца
  cum_fact       numeric(14,2) not null,
  lag            numeric(14,2) not null,  -- cum_base − cum_fact (минус — опережение)
  remaining      numeric(14,2) not null,  -- осталось получить до конца месяца
  next_targets   jsonb not null default '[]',
  taken_at       timestamptz not null default now(),
  unique (unit, period_end)
);

alter table public.cashflow_period_snapshots enable row level security;

drop policy if exists cf_snap_select on public.cashflow_period_snapshots;
create policy cf_snap_select on public.cashflow_period_snapshots for select to authenticated using (
  exists (select 1 from crm_caller() c where c.u_role in ('accountant','cfo','admin','ceo'))
);
