-- Шаг 3 пути сделки: розничные оплаты ПРЯМО на сделке (розничного денежного контура в
-- базе нет — invoices это B2B-регистр). Три вида по словам владельца: предоплата, остаток,
-- остаток за монтаж. Каждая — сумма, дата, кто внёс. На этом строятся поступления за
-- период и зарплата. Зарабатывающий менеджер = deals.manager_id.
-- Сумма свободная (не из %); отметок одного вида может быть несколько (без уникальности);
-- paid_at (дата поступления денег) отдельно от created_at (когда внесли запись).

create table if not exists public.deal_payments (
  id bigint generated always as identity primary key,
  deal_id bigint not null references public.deals(id) on delete cascade,
  kind text not null check (kind in ('prepay', 'balance', 'install')),  -- предоплата · остаток · остаток за монтаж
  amount numeric(12,2) not null check (amount >= 0),
  paid_at date not null default current_date,
  entered_by uuid references public.users(id) on delete set null,
  entered_by_name text,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_deal_payments_deal on public.deal_payments(deal_id);
create index if not exists idx_deal_payments_paid_at on public.deal_payments(paid_at);

alter table public.deal_payments enable row level security;

-- Политика через join к сделке (у платежа своего владельца нет). Непустая политика
-- обязательна: RLS без политик отвечает 200 с пустым телом и молчит.
drop policy if exists deal_payments_select on public.deal_payments;
create policy deal_payments_select on public.deal_payments for select to authenticated using (
  exists (select 1 from public.deals d where d.id = deal_payments.deal_id and (
    d.created_by = auth.uid() or d.manager_id = auth.uid()
    or exists (select 1 from public.users u where u.id = auth.uid()
               and (u.role in ('admin','ceo','commercial','cfo') or u.can_view_all_clients = true))))
);

drop policy if exists deal_payments_write on public.deal_payments;
create policy deal_payments_write on public.deal_payments for all to authenticated using (
  exists (select 1 from public.deals d where d.id = deal_payments.deal_id and (
    d.created_by = auth.uid() or d.manager_id = auth.uid()
    or exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('admin','ceo','commercial'))))
) with check (
  exists (select 1 from public.deals d where d.id = deal_payments.deal_id and (
    d.created_by = auth.uid() or d.manager_id = auth.uid()
    or exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('admin','ceo','commercial'))))
);

grant select, insert, update, delete on public.deal_payments to authenticated;
