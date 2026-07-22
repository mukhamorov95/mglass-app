-- Реестр выставленных счетов. Единый счёт на несколько заказов перестаёт быть
-- «печатью на лету» и становится документом: номер, плательщик, состав заказов,
-- сумма, статус оплаты. Незакрытые счета = дебиторка.
create table if not exists invoices (
  id            bigserial primary key,
  invoice_no    text not null,
  payer_client_id bigint references b2b_clients(id),
  payer_name    text,
  order_ids     bigint[] not null default '{}',
  amount        numeric(14,2) not null default 0,
  vat           numeric(14,2) not null default 0,
  status        text not null default 'issued'
                check (status in ('issued','paid','cancelled')),
  issued_at     date not null default (now() at time zone 'Europe/Moscow')::date,
  paid_at       date,
  comment       text,
  created_by      uuid references users(id) on delete set null,
  created_by_name text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_invoices_status on invoices (status, issued_at desc);
create index if not exists idx_invoices_payer on invoices (payer_client_id);

alter table invoices enable row level security;
create policy invoices_select on invoices for select to authenticated using (
  exists (select 1 from crm_caller() c where c.u_role in ('admin','ceo','cfo','accountant','commercial'))
);
create policy invoices_insert on invoices for insert to authenticated with check (
  exists (select 1 from crm_caller() c where c.u_role in ('admin','ceo','cfo','accountant','commercial'))
);
create policy invoices_update on invoices for update to authenticated using (
  exists (select 1 from crm_caller() c where c.u_role in ('admin','ceo','cfo','accountant','commercial'))
);
