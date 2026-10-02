-- Входящие заявки B2B (концепция Авито v2, docs/avito-b2b/CONCEPT.md): заявка с Авито и других
-- каналов до того, как стала клиентом. Отдельно от b2b_leads — это холодный поиск, и
-- /api/admin/b2b-seed стирает его целиком.
-- Статусы и источники продублированы в lib/b2b/inquiries.ts и B2B_SOURCES (lib/types.ts).
create table if not exists public.b2b_inquiries (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  source text not null default 'avito',
  contact_name text,
  company text,
  phone text,
  request text,
  chat_url text,
  listing text,
  status text not null default 'new',
  answered_at timestamptz,
  closed_at timestamptz,
  lost_reason text,
  b2b_client_id integer references public.b2b_clients(id) on delete set null,
  created_by uuid default auth.uid() references public.users(id) on delete set null,
  assigned_to uuid references public.users(id) on delete set null,
  constraint b2b_inquiries_source_check check (source in (
    'avito', 'referral', 'partner_program', 'website', 'yandex_maps',
    '2gis', 'exhibition', 'cold_call', 'retail', 'other'
  )),
  constraint b2b_inquiries_status_check check (status in ('new', 'answered', 'quoted', 'won', 'lost')),
  constraint b2b_inquiries_who_check check (coalesce(contact_name, company, phone, chat_url) is not null)
);

create index if not exists b2b_inquiries_status_idx on public.b2b_inquiries (status, created_at desc);

drop trigger if exists set_b2b_inquiries_updated_at on public.b2b_inquiries;
create trigger set_b2b_inquiries_updated_at
  before update on public.b2b_inquiries
  for each row execute function public.update_updated_at_column();

alter table public.b2b_inquiries enable row level security;
revoke all on public.b2b_inquiries from anon;

-- Владелец видит весь входящий поток; сотрудник — заявки, которые завёл сам или которые
-- ему назначены (изоляция менеджера, правило 4). Партнёр и аноним — ничего: в предикате
-- только allow-list, uid аноним не проходит ни одну ветку.
drop policy if exists "Inquiries read" on public.b2b_inquiries;
create policy "Inquiries read" on public.b2b_inquiries for select to authenticated
  using (is_owner() or created_by = auth.uid() or assigned_to = auth.uid());

drop policy if exists "Inquiries insert" on public.b2b_inquiries;
create policy "Inquiries insert" on public.b2b_inquiries for insert to authenticated
  with check (
    created_by = auth.uid()
    and exists (select 1 from public.users u where u.id = auth.uid()
                and u.role in ('admin', 'ceo', 'manager', 'commercial', 'buyer'))
  );

drop policy if exists "Inquiries update" on public.b2b_inquiries;
create policy "Inquiries update" on public.b2b_inquiries for update to authenticated
  using (is_owner() or created_by = auth.uid() or assigned_to = auth.uid())
  with check (is_owner() or created_by = auth.uid() or assigned_to = auth.uid());

drop policy if exists "Inquiries delete" on public.b2b_inquiries;
create policy "Inquiries delete" on public.b2b_inquiries for delete to authenticated
  using (is_owner());
