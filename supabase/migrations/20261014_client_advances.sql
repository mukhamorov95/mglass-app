-- Аванс клиента B2B (14.10, ГлассДекор: 400 000 ₽ вперёд, запускаемые заказы списываются
-- с него). Сам аванс — не платёж: платёж в ядре всегда привязан к заказу или счёту
-- (buildPaymentRow), а у аванса заказа ещё нет. Списание на заказ — обычный платёж
-- payments с ключом advance:<id>:<заказ> (lib/accounting/clientAdvance.ts), так его видят
-- все экраны оплаты без доработки. Остаток аванса = сумма − живые списания.

create table if not exists public.client_advances (
  id              bigserial primary key,
  client_id       bigint not null references public.b2b_clients(id),
  unit            text not null check (unit in ('ip', 'ooo')),
  bank_row_id     bigint unique references public.bank_statement_rows(id),
  amount          numeric(14,2) not null check (amount > 0),
  received_at     date not null,
  -- с какой даты запуска заказы клиента списываются с этого аванса
  applies_from    date not null,
  note            text,
  created_by      uuid,
  created_by_name text,
  created_at      timestamptz not null default now(),
  voided_at       timestamptz,
  voided_by       uuid
);

create index if not exists client_advances_client_idx on public.client_advances (client_id) where voided_at is null;

alter table public.client_advances enable row level security;
-- Деньги клиента: только серверные маршруты финконтура под service-role.
revoke all on public.client_advances from anon, authenticated;
