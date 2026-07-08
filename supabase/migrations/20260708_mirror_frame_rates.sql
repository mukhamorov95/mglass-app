-- Зеркало в металлической раме: ставки себестоимости рамы (сварной каркас из
-- холоднокатанного листа). v1 — плоские средние ставки владельца, калибруются
-- в /admin/mirror-frame-rates. Зеркало считается как обычно (по площади), рама
-- добавляется этими строками; итог — по стандартной финмодели (маржа/налог mirror).

create table if not exists public.mirror_frame_rates (
  key   text primary key,
  label text not null,
  unit  text not null,
  value numeric not null default 0,
  sort  int not null default 0
);

insert into public.mirror_frame_rates (key, label, unit, value, sort) values
  ('metal',    'Металл (холоднокатанный лист) на раму', '₽/зеркало', 2000, 10),
  ('cutting',  'Резка / раскрой полос',                 '₽/зеркало', 2000, 20),
  ('welding',  'Сварка каркаса',                        '₽/зеркало', 2500, 30),
  ('painting', 'Покраска порошковая (RAL)',             '₽/зеркало', 4000, 40),
  ('assembly', 'Сборка зеркала в раме',                 '₽/зеркало', 1500, 50)
on conflict (key) do nothing;

-- Референс-чертежи (чертёж зеркала на согласование + крой) — для понимания/калибровки.
create table if not exists public.mirror_frame_refs (
  id         bigserial primary key,
  url        text not null,
  label      text,
  created_at timestamptz not null default now()
);

alter table public.mirror_frame_rates enable row level security;
alter table public.mirror_frame_refs  enable row level security;

drop policy if exists "auth_read_mfr"   on public.mirror_frame_rates;
create policy "auth_read_mfr"   on public.mirror_frame_rates for select using (auth.uid() is not null);
drop policy if exists "auth_update_mfr" on public.mirror_frame_rates;
create policy "auth_update_mfr" on public.mirror_frame_rates for update using (auth.uid() is not null) with check (auth.uid() is not null);
drop policy if exists "auth_all_mfrefs" on public.mirror_frame_refs;
create policy "auth_all_mfrefs" on public.mirror_frame_refs using (auth.uid() is not null) with check (auth.uid() is not null);
