-- Б3: месячный план поступлений для финнедели чт–ср.
-- Значение берётся из точки безубыточности (/cfo/breakeven) перед началом
-- месяца и вносится вручную по каждому юниту (ип/ооо ≠ юниты ТБ-модели).

create table cashflow_month_plans (
  id           bigserial primary key,
  unit         text not null check (unit in ('ip','ooo')),
  month        text not null check (month ~ '^\d{4}-\d{2}$'),
  plan_amount  numeric(14,2) not null check (plan_amount >= 0),
  note         text,
  updated_by   text,
  updated_at   timestamptz not null default now(),
  unique (unit, month)
);

alter table cashflow_month_plans enable row level security;

create policy cf_plans_select on cashflow_month_plans for select to authenticated using (
  exists (select 1 from crm_caller() c where c.u_role in ('accountant','cfo','admin','ceo'))
);
create policy cf_plans_insert on cashflow_month_plans for insert to authenticated with check (
  exists (select 1 from crm_caller() c where c.u_role in ('accountant','cfo','admin','ceo'))
);
create policy cf_plans_update on cashflow_month_plans for update to authenticated using (
  exists (select 1 from crm_caller() c where c.u_role in ('accountant','cfo','admin','ceo'))
);
