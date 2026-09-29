-- Какие экраны открывают (маршрут docs/MANAGER_UX_ROUTE.md, У0).
-- user_activity_days знает только «был сегодня»; по нему нельзя понять, чем человек
-- пользуется, и переделка экранов шла бы вслепую. Здесь — счётчик переходов по
-- маршруту без идентификаторов (/b2b-deal/[id]) и классу устройства, день в UTC,
-- как в user_activity_days.

create table if not exists public.user_page_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default current_date,
  route text not null,
  device text not null check (device in ('mobile', 'tablet', 'desktop')),
  hits integer not null default 1,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  primary key (user_id, day, route, device)
);

alter table public.user_page_days enable row level security;

-- Читает только владелец. Прямой записи нет ни у кого: только через функцию ниже,
-- которая пишет строго от имени вошедшего.
drop policy if exists page_days_owner_read on public.user_page_days;
create policy page_days_owner_read on public.user_page_days
  for select using (public.is_owner());

create or replace function public.track_page_view(p_route text, p_device text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then return; end if;
  -- Мусор из консоли браузера не пишем: маршрут — только путь приложения.
  if p_route is null or p_route !~ '^/[A-Za-z0-9/_\[\]\-]{0,119}$' then return; end if;
  if p_device not in ('mobile', 'tablet', 'desktop') then p_device := 'desktop'; end if;

  insert into public.user_page_days (user_id, day, route, device)
  values (auth.uid(), current_date, p_route, p_device)
  on conflict (user_id, day, route, device)
  do update set hits = public.user_page_days.hits + 1, last_seen = now();
end;
$$;

revoke all on function public.track_page_view(text, text) from public, anon;
grant execute on function public.track_page_view(text, text) to authenticated;
