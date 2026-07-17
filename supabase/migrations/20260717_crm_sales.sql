-- Отдел продаж: леджер продаж (одна вкладка). Менеджер отмечает «Продано» в
-- карточке лида или вносит вручную → строка с суммой, оплатой, менеджером, датами.
-- Маржа — отдельной фазой (поля себестоимости добавим позже). Изоляция в коде
-- (менеджер видит свои), RLS permissive для authenticated. Ничего не ломает.
create table if not exists crm_sales (
  id bigserial primary key,
  lead_id bigint references crm_leads(id) on delete set null,
  sale_date date not null default current_date,
  ready_date date,
  department text not null default 'Розница',
  order_no text,
  client text,
  amount numeric not null,                 -- сумма заказа (почём продал)
  partner_fee numeric not null default 0,  -- партнёрские
  prepayment numeric not null default 0,   -- предоплата (остаток = amount - prepayment)
  prepayment_paid boolean not null default false,
  remainder_paid boolean not null default false,
  payment_method text not null default 'Счёт',   -- Счёт | Наличные
  manager text,
  status text not null default 'open' check (status in ('open','closed')),  -- не закрыт | закрыт
  note text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_crm_sales_date on crm_sales (sale_date desc);
create index if not exists idx_crm_sales_manager on crm_sales (manager);
create index if not exists idx_crm_sales_lead on crm_sales (lead_id);

alter table crm_sales enable row level security;
drop policy if exists crm_sales_all on crm_sales;
create policy crm_sales_all on crm_sales for all to authenticated using (true) with check (true);
