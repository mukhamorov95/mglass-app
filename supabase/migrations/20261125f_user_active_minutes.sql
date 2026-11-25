-- Активные минуты (владелец 25.11.2026: «сколько Вера и Нуржан были в приложении»).
-- user_activity_days даёт окно «первый → последний заход» — открытая вкладка тоже считается.
-- Здесь минута засчитывается, только если вкладка на экране и человек за эту минуту
-- что-то делал (мышь, клавиатура, касание, прокрутка). Несколько вкладок — одна минута:
-- функция не добавляет минуту чаще раза в 50 секунд. День в UTC, как в user_activity_days.

create table if not exists public.user_active_minutes (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default current_date,
  minutes integer not null default 0,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.user_active_minutes enable row level security;
drop policy if exists active_minutes_owner_read on public.user_active_minutes;
create policy active_minutes_owner_read on public.user_active_minutes
  for select using (public.is_owner());

create or replace function public.track_active_minute()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.user_active_minutes (user_id, day, minutes)
  values (auth.uid(), current_date, 1)
  on conflict (user_id, day)
  do update set minutes = public.user_active_minutes.minutes + 1, last_at = now()
  where public.user_active_minutes.last_at <= now() - interval '50 seconds';
end;
$$;

revoke all on function public.track_active_minute() from public, anon;
grant execute on function public.track_active_minute() to authenticated;
