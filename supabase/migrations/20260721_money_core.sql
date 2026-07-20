-- Денежное ядро (Д1, docs/ERP_MONEY_ARCHITECTURE.md).
-- Один платёж = одна строка. Пишет ТОЛЬКО сервер (service-role) через
-- lib/payments/recordPayment.ts — INSERT/UPDATE-политик для клиентов нет.
-- Платежи не удаляются: voided_at или kind='refund'.

create table payments (
  id            bigint generated always as identity primary key,
  -- типизированные ссылки на документ; минимум одна обязательна
  b2b_order_id  bigint references b2b_orders(id) on delete restrict,
  order_id      uuid   references orders(id)     on delete restrict,
  crm_sale_id   bigint references crm_sales(id)  on delete restrict,
  constraint payments_has_document
    check (num_nonnulls(b2b_order_id, order_id, crm_sale_id) >= 1),

  amount        numeric(14,2) not null check (amount > 0),
  paid_at       date not null,
  kind          text not null check (kind in ('prepayment','remainder','full','refund','adjustment')),
  method        text not null default 'Счёт' check (method in ('Счёт','Наличные','Карта','Перевод','Другое')),

  entered_by      uuid references users(id) on delete set null,
  entered_by_name text,
  source        text not null,
  external_key  text not null unique,
  import_batch  text,

  voided_at     timestamptz,
  voided_by     uuid references users(id) on delete set null,
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_payments_paid_at on payments (paid_at desc) where voided_at is null;
create index idx_payments_b2b   on payments (b2b_order_id) where b2b_order_id is not null;
create index idx_payments_order on payments (order_id)     where order_id is not null;
create index idx_payments_sale  on payments (crm_sale_id)  where crm_sale_id is not null;

-- Ведомость продаж: связи с документами + процессные поля
alter table crm_sales
  add column if not exists order_id       uuid   unique references orders(id),
  add column if not exists b2b_order_id   bigint unique references b2b_orders(id),
  add column if not exists calculation_id bigint references calculations(id),
  add column if not exists paid_remainder_at date,
  add column if not exists product_type   text,
  add column if not exists source         text,
  add column if not exists needs_review   boolean not null default false,
  add column if not exists voided         boolean not null default false,
  add column if not exists external_key   text unique,
  add column if not exists import_batch   text;

-- Себестоимость — дочерней таблицей: RLS в Postgres построчная, колонка cost
-- на crm_sales была бы читаема менеджером через crm_sales_select.
create table crm_sale_finance (
  sale_id        bigint primary key references crm_sales(id) on delete cascade,
  cost           numeric(14,2) not null default 0,
  cost_source    text not null default 'manual' check (cost_source in ('calculation','order','b2b_order','import','manual')),
  cost_overridden boolean not null default false,
  updated_at     timestamptz not null default now()
);

-- Маржу считает ТОЛЬКО этот view (не API, не руки, не AI).
-- security_invoker: RLS обеих таблиц наследуется читателем.
create view v_crm_sales_margin with (security_invoker = true) as
select s.*, f.cost, f.cost_source,
  round((s.amount - coalesce(s.partner_fee, 0) - f.cost) / nullif(s.amount, 0) * 100, 1) as margin_percent
from crm_sales s join crm_sale_finance f on f.sale_id = s.id;

alter table payments enable row level security;
alter table crm_sale_finance enable row level security;

-- SELECT: владельцы-финансы всё; менеджер — платежи своих продаж; цех/seo — ничего.
create policy payments_select on payments for select to authenticated using (
  exists (select 1 from crm_caller() c where c.u_role in ('admin','ceo','cfo'))
  or exists (select 1 from crm_caller() c
       join crm_sales s on s.id = payments.crm_sale_id
       where c.u_role = 'manager' and s.manager = c.u_name)
);
-- INSERT/UPDATE/DELETE-политик нет: пишет только service-role.

create policy sale_finance_all on crm_sale_finance for all to authenticated using (
  exists (select 1 from crm_caller() c where c.u_role in ('admin','ceo','cfo'))
) with check (
  exists (select 1 from crm_caller() c where c.u_role in ('admin','ceo','cfo'))
);
