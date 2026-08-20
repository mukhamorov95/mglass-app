-- Таблицы для /admin/mirror-frame-rates отсутствовали в БД → страница калибровки
-- ставок «зеркало в металлической раме» была сломана (404 на mirror_frame_rates и
-- mirror_frame_refs). Расчёт при этом работал на дефолтных ставках-фолбэках из
-- lib/b2bFactoryProducts.ts. Создаём таблицы и сидим теми же дефолтами —
-- поведение расчёта не меняется, но владелец снова может калибровать ставки.

create table if not exists public.mirror_frame_rates (
  key   text primary key,
  label text not null,
  unit  text not null default '₽',
  value numeric not null default 0,
  sort  int not null default 0
);

-- Дефолты = фолбэки fr(...) в b2bFactoryProducts.ts (metal/cutting/welding/painting/assembly).
insert into public.mirror_frame_rates (key, label, unit, value, sort) values
  ('metal',    'Металл на раму (холоднокатанный лист)', '₽', 2000, 1),
  ('cutting',  'Резка / раскрой полос',                 '₽', 2000, 2),
  ('welding',  'Сварка каркаса',                        '₽', 2500, 3),
  ('painting', 'Покраска порошковая (RAL)',             '₽', 4000, 4),
  ('assembly', 'Сборка зеркала в раме',                 '₽', 1500, 5)
on conflict (key) do nothing;

create table if not exists public.mirror_frame_refs (
  id         bigint generated always as identity primary key,
  url        text not null,
  label      text,
  created_at timestamptz not null default now()
);

alter table public.mirror_frame_rates enable row level security;
alter table public.mirror_frame_refs  enable row level security;

-- Читают сотрудники (не партнёры), ставки правит кто может редактировать
-- ценообразование (как facet_prices). Референсы правят сотрудники. Service-role
-- (серверные роуты) минует RLS в любом случае.
drop policy if exists mfr_read   on public.mirror_frame_rates;
drop policy if exists mfr_insert on public.mirror_frame_rates;
drop policy if exists mfr_update on public.mirror_frame_rates;
create policy mfr_read   on public.mirror_frame_rates for select using (not is_partner());
create policy mfr_insert on public.mirror_frame_rates for insert with check (can_edit_pricing());
create policy mfr_update on public.mirror_frame_rates for update using (can_edit_pricing()) with check (can_edit_pricing());

drop policy if exists mfref_read   on public.mirror_frame_refs;
drop policy if exists mfref_insert on public.mirror_frame_refs;
drop policy if exists mfref_delete on public.mirror_frame_refs;
create policy mfref_read   on public.mirror_frame_refs for select using (not is_partner());
create policy mfref_insert on public.mirror_frame_refs for insert with check (not is_partner());
create policy mfref_delete on public.mirror_frame_refs for delete using (not is_partner());
