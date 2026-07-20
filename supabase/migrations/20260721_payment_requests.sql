-- Б2: заявки на расходы (замена платной сторонней программы).
-- Закупщик/владелец/бухгалтерия создают заявки: фонд+подфонд, сумма,
-- контрагент, способ, счёт-вложение. Четверг — комитет: одобрить/перенести/
-- отменить. Правило владельца: заявки НИКОГДА не удаляются — отменённые
-- хранятся и возвращаемы. Оплата заявки рождает cashflow_entry.

create table payment_requests (
  id            bigserial primary key,
  unit          text not null check (unit in ('ip','ooo')),
  fund_id       bigint not null references cashflow_funds(id),
  subfund_id    bigint references cashflow_subfunds(id),
  amount        numeric(14,2) not null check (amount > 0),
  counterparty  text,
  method        text not null default 'Безнал' check (method in ('Безнал','Наличные','Карта')),
  invoice_path  text,            -- счёт на оплату в storage (b2b-attachments)
  comment       text,
  desired_date  date,            -- когда нужно оплатить
  status        text not null default 'pending'
                check (status in ('pending','approved','postponed','cancelled','paid')),
  status_changed_at timestamptz,
  status_changed_by text,
  entry_id      bigint references cashflow_entries(id),  -- факт оплаты
  created_by      uuid references users(id) on delete set null,
  created_by_name text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_payreq_status on payment_requests (status, created_at desc);
create index idx_payreq_fund on payment_requests (fund_id);

alter table payment_requests enable row level security;

-- Финконтур видит всё; закупщик (buyer) — только свои заявки.
create policy payreq_select on payment_requests for select to authenticated using (
  exists (select 1 from crm_caller() c where c.u_role in ('accountant','cfo','admin','ceo'))
  or (exists (select 1 from crm_caller() c where c.u_role = 'buyer') and created_by = auth.uid())
);
create policy payreq_insert on payment_requests for insert to authenticated with check (
  exists (select 1 from crm_caller() c where c.u_role in ('accountant','cfo','admin','ceo','buyer'))
  and created_by = auth.uid()
);
-- Статусы меняет финконтур; DELETE-политики нет — заявки не удаляются.
create policy payreq_update on payment_requests for update to authenticated using (
  exists (select 1 from crm_caller() c where c.u_role in ('accountant','cfo','admin','ceo'))
);

-- Закупщику нужен справочник фондов для выбора в заявке (только чтение).
drop policy if exists cf_funds_select on cashflow_funds;
create policy cf_funds_select on cashflow_funds for select to authenticated using (
  exists (select 1 from crm_caller() c where c.u_role in ('accountant','cfo','admin','ceo','buyer'))
);
create policy cf_subfunds_select_buyer on cashflow_subfunds for select to authenticated using (
  exists (select 1 from crm_caller() c where c.u_role = 'buyer')
);
