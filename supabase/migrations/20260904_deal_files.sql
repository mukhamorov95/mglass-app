-- Шаг 4 пути сделки: файлы сделки (чертёж и прочее), видны менеджеру в карточке.
-- Отдельно от measure_requests.photos (то — файлы замера); тут — чертёж/документы уровня
-- сделки. kind по умолчанию 'drawing'. RLS через join к сделке (непустая политика).
-- В select-политику добавлена роль production — чтобы цех видел чертёж сделки.

create table if not exists public.deal_files (
  id bigint generated always as identity primary key,
  deal_id bigint not null references public.deals(id) on delete cascade,
  kind text not null default 'drawing',
  url text not null,
  name text,
  uploaded_by uuid references public.users(id) on delete set null,
  uploaded_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists idx_deal_files_deal on public.deal_files(deal_id);

alter table public.deal_files enable row level security;

drop policy if exists deal_files_select on public.deal_files;
create policy deal_files_select on public.deal_files for select to authenticated using (
  exists (select 1 from public.deals d where d.id = deal_files.deal_id and (
    d.created_by = auth.uid() or d.manager_id = auth.uid()
    or exists (select 1 from public.users u where u.id = auth.uid()
               and (u.role in ('admin','ceo','commercial','cfo','production') or u.can_view_all_clients = true))))
);

drop policy if exists deal_files_write on public.deal_files;
create policy deal_files_write on public.deal_files for all to authenticated using (
  exists (select 1 from public.deals d where d.id = deal_files.deal_id and (
    d.created_by = auth.uid() or d.manager_id = auth.uid()
    or exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('admin','ceo','commercial'))))
) with check (
  exists (select 1 from public.deals d where d.id = deal_files.deal_id and (
    d.created_by = auth.uid() or d.manager_id = auth.uid()
    or exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('admin','ceo','commercial'))))
);

grant select, insert, update, delete on public.deal_files to authenticated;
