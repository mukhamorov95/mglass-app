-- Состав фонда ДДС (владелец 22.10.2026): плановая сумма подфонда в месяц — оклад человека,
-- аренда и т.п.; план фонда = сумма планов его подфондов. Отдельная таблица, а не колонка
-- cashflow_subfunds: подфонды читает и закупщик (заявки на оплату), а оклады ему не видны.
create table if not exists public.cashflow_subfund_plans (
  subfund_id   bigint primary key references public.cashflow_subfunds(id) on delete cascade,
  plan_monthly numeric(14,2) not null check (plan_monthly >= 0),
  updated_by   text,
  updated_at   timestamptz not null default now()
);
alter table public.cashflow_subfund_plans enable row level security;
drop policy if exists cf_subfund_plans_fin on public.cashflow_subfund_plans;
create policy cf_subfund_plans_fin on public.cashflow_subfund_plans for all to authenticated
  using (exists (select 1 from crm_caller() c where c.u_role in ('accountant','cfo','admin','ceo')))
  with check (exists (select 1 from crm_caller() c where c.u_role in ('accountant','cfo','admin','ceo')));
revoke all on public.cashflow_subfund_plans from anon;
