-- Б9: банковская выписка. Строка выписки — не операция ДДС, а её кандидат:
-- бухгалтер подтверждает разнесение, и только тогда рождается cashflow_entry.
-- external_key собирается парсером из даты, суммы, номера документа и ИНН —
-- повторная загрузка того же файла не плодит дублей.
create table if not exists bank_statement_rows (
  id            bigserial primary key,
  unit          text not null check (unit in ('ip','ooo')),
  external_key  text not null,
  doc_no        text,
  op_date       date not null,
  amount        numeric(14,2) not null check (amount > 0),
  direction     text not null check (direction in ('in','out')),
  counterparty  text,
  inn           text,
  purpose       text,
  account       text,
  status        text not null default 'new' check (status in ('new','posted','skipped')),
  entry_id      bigint references cashflow_entries(id),
  request_id    bigint references payment_requests(id),
  import_batch  text,
  imported_by   text,
  created_at    timestamptz not null default now(),
  unique (unit, external_key)
);
create index if not exists idx_bank_rows_status on bank_statement_rows (unit, status, op_date desc);

alter table bank_statement_rows enable row level security;
create policy bank_rows_select on bank_statement_rows for select to authenticated using (
  exists (select 1 from crm_caller() c where c.u_role in ('accountant','cfo','admin','ceo'))
);
-- Пишет только серверный роут (service-role): он проверяет роль и рождает операцию.

-- Б9+: связь строки выписки со счётом и с денежным ядром. Шов согласован с
-- backbone-сессией: факт денег живёт в payments, статус B2B-заказа — производная
-- от ядра и считается на стороне backbone; из бухгалтерии заказ не трогаем.
alter table bank_statement_rows
  add column if not exists invoice_id bigint references invoices(id),
  add column if not exists payment_id bigint references payments(id);
