-- Зеркало книги владельца «Маржа»: одна строка книги = один объект с его
-- переменными расходами по статьям. Пишет только ежедневная сверка
-- (lib/sales/marginBook.ts, service-role); читают владельцы-финансы.
--
-- Пустая ячейка — null, а не 0: «расход не проставлен» и «расхода не было»
-- (0 в книге) — разные ответы на вопрос «объект посчитан?».
-- Себестоимость для витрины v_crm_sales_margin по-прежнему в crm_sale_finance —
-- сверка пишет её туда же, из этих строк.

create table if not exists margin_book_rows (
  id             bigserial primary key,
  external_key   text not null unique,          -- marja:<YYYY-MM>:<строка книги>
  ledger_month   text not null,                 -- месяц вкладки, как в книге продаж
  tab            text not null,
  row_no         int  not null,
  order_no       text,
  sale_id        bigint references crm_sales(id) on delete set null,
  amount         numeric(14,2),
  glass          numeric(14,2),
  hardware       numeric(14,2),
  designer       numeric(14,2),
  measurer       numeric(14,2),
  installer      numeric(14,2),
  delivery       numeric(14,2),
  partners       numeric(14,2),
  claims         numeric(14,2),
  tax            numeric(14,2),
  bonus_manager  numeric(14,2),
  bonus_ror      numeric(14,2),
  bonus_rop      numeric(14,2),
  text_cells     text[] not null default '{}',  -- статьи, набранные текстом: формула книги их не считает
  book_var_total numeric(14,2),                 -- «Итого переменных» по формуле книги
  book_md        numeric(14,2),
  dima           numeric(14,2),
  voided         boolean not null default false,
  synced_at      timestamptz not null default now()
);

create index if not exists idx_margin_book_rows_month on margin_book_rows (ledger_month) where not voided;
create index if not exists idx_margin_book_rows_sale  on margin_book_rows (sale_id) where sale_id is not null;

alter table margin_book_rows enable row level security;

drop policy if exists margin_book_rows_select on margin_book_rows;
create policy margin_book_rows_select on margin_book_rows for select to authenticated using (
  exists (select 1 from crm_caller() c where c.u_role in ('admin','ceo','cfo'))
);
-- INSERT/UPDATE/DELETE-политик нет: пишет только service-role.

revoke all on margin_book_rows from anon;
