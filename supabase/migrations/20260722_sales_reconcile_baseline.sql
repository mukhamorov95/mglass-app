-- Замороженный снимок верных месячных итогов продаж (сверено 24/25 месяцев с
-- книгой владельца). Ночной cron сравнивает текущие данные с ним: если закрытый
-- месяц «просел» — значит данные повредились/удалились (класс бага, когда
-- витрина молча теряла строки). Обновляется вручную при осознанной коррекции.
create table if not exists sales_reconcile_baseline (
  ledger_month   text not null,
  department     text not null default 'mglass',
  expected_total numeric(14,2) not null,
  rows_count     integer not null,
  frozen_at      timestamptz not null default now(),
  primary key (ledger_month, department)
);
alter table sales_reconcile_baseline enable row level security;
create policy srb_select on sales_reconcile_baseline for select to authenticated using (
  exists (select 1 from crm_caller() c where c.u_role in ('admin','ceo','cfo'))
);

-- Сид: закрытые месяцы (всё до текущего) из сырой таблицы crm_sales, dept=mglass.
insert into sales_reconcile_baseline (ledger_month, department, expected_total, rows_count)
select coalesce(ledger_month, to_char(sale_date,'YYYY-MM')) m, 'mglass',
       sum(amount), count(*)
from crm_sales
where voided = false and department is distinct from 'b2b'
  and coalesce(ledger_month, to_char(sale_date,'YYYY-MM')) < to_char(now() at time zone 'Europe/Moscow', 'YYYY-MM')
group by 1
on conflict (ledger_month, department) do nothing;
