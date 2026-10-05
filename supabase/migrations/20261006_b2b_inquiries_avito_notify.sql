-- Чаты GLASMEN на Авито сами становятся входящими заявками B2B (не в AmoCRM — решение
-- владельца 05.10), а о новой заявке приходит уведомление в Telegram.
-- Вебхук пишет service-role'ом (app/api/avito/webhook/glasmen), поэтому created_by у таких
-- заявок пуст: их видит владелец (is_owner) и тот, кому заявку назначат.
alter table public.b2b_inquiries
  add column if not exists avito_chat_id text,
  add column if not exists avito_item_id bigint,
  add column if not exists last_message_at timestamptz;

create unique index if not exists b2b_inquiries_avito_chat_uidx
  on public.b2b_inquiries (avito_chat_id) where avito_chat_id is not null;

-- Кому слать уведомления о заявках. Отдельная таблица, а не флаг в users: свою строку users
-- сотрудник правит сам и включил бы себе поток чужих заявок с телефонами. Список ведёт владелец.
create table if not exists public.b2b_inquiry_notify (
  user_id uuid primary key references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references public.users(id) on delete set null
);

alter table public.b2b_inquiry_notify enable row level security;
revoke all on public.b2b_inquiry_notify from anon;

drop policy if exists "Inquiry notify owner read" on public.b2b_inquiry_notify;
create policy "Inquiry notify owner read" on public.b2b_inquiry_notify for select to authenticated
  using (is_owner());
drop policy if exists "Inquiry notify owner insert" on public.b2b_inquiry_notify;
create policy "Inquiry notify owner insert" on public.b2b_inquiry_notify for insert to authenticated
  with check (is_owner());
drop policy if exists "Inquiry notify owner delete" on public.b2b_inquiry_notify;
create policy "Inquiry notify owner delete" on public.b2b_inquiry_notify for delete to authenticated
  using (is_owner());

-- Сейчас уведомления получает владелец; менеджера он добавит сам на экране заявок.
insert into public.b2b_inquiry_notify (user_id)
  select id from public.users where role = 'admin'
  on conflict (user_id) do nothing;
