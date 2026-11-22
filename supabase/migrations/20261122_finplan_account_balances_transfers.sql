-- ФП Ф3 (docs/finplan/FINPLAN_ROUTE.md): остатки счетов и переводы между своими.
-- Остаток на конец дня as_of: из выписки (source='bank' — начальный остаток даёт
-- строку на день раньше периода, конечный — на последний день) или введённый
-- финотделом (source='manual' — касса, наличка, счёт без выписок).
create table if not exists public.cashflow_account_balances (
  id          bigserial primary key,
  unit        text not null check (unit in ('ip','ooo')),
  account     text not null,
  as_of       date not null,
  balance     numeric(14,2) not null,
  source      text not null check (source in ('bank','manual')),
  import_batch text,
  entered_by  text,
  created_at  timestamptz not null default now(),
  unique (unit, account, as_of, source)
);

-- Перевод между своими счетами одного юнита: меняет остатки двух счетов, общий
-- остаток и оборот ДДС не меняет.
create table if not exists public.cashflow_transfers (
  id           bigserial primary key,
  unit         text not null check (unit in ('ip','ooo')),
  op_date      date not null,
  from_account text not null,
  to_account   text not null,
  amount       numeric(14,2) not null check (amount > 0),
  comment      text,
  created_by_name text,
  created_at   timestamptz not null default now(),
  check (from_account <> to_account)
);
create index if not exists idx_cf_transfers on public.cashflow_transfers (unit, op_date);

alter table public.cashflow_account_balances enable row level security;
alter table public.cashflow_transfers enable row level security;

drop policy if exists cf_balances_all on public.cashflow_account_balances;
create policy cf_balances_all on public.cashflow_account_balances for all to authenticated using (
  exists (select 1 from crm_caller() c where c.u_role in ('accountant','cfo','admin','ceo'))
) with check (
  exists (select 1 from crm_caller() c where c.u_role in ('accountant','cfo','admin','ceo'))
);

drop policy if exists cf_transfers_all on public.cashflow_transfers;
create policy cf_transfers_all on public.cashflow_transfers for all to authenticated using (
  exists (select 1 from crm_caller() c where c.u_role in ('accountant','cfo','admin','ceo'))
) with check (
  exists (select 1 from crm_caller() c where c.u_role in ('accountant','cfo','admin','ceo'))
);

drop trigger if exists audit_change on public.cashflow_account_balances;
create trigger audit_change after insert or delete or update on public.cashflow_account_balances
  for each row execute function audit_change('unit,account,as_of', '', '');
drop trigger if exists audit_change on public.cashflow_transfers;
create trigger audit_change after insert or delete or update on public.cashflow_transfers
  for each row execute function audit_change('unit,op_date', '', '');
