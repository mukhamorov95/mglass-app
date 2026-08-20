-- Справочник ставок лестничных/прямых ограждений.
-- Хранит СЕБЕСТОИМОСТЬ (value) по именованным ставкам + правила количества.
-- Продажная цена не хранится: считается на лету по финмодели (маржа/налог),
-- кроме ручного override (sale_override). vendor/source_url — откуда взята цена.
-- По образцу loft_rates / mirror_frame_rates.

create table if not exists public.railing_rates (
  key           text primary key,
  label         text not null,
  unit          text not null,
  kind          text not null default 'cost',   -- 'cost' (₽, наценивается) | 'rule' (правило количества)
  value         numeric not null default 0,      -- себестоимость или значение правила
  sale_override numeric,                          -- ручная продажная цена (null = по финмодели)
  vendor        text,                             -- продавец / источник цены
  source_url    text,                             -- ссылка на источник
  sort          int not null default 0
);

insert into public.railing_rates (key, label, unit, kind, value, sort) values
  ('mount_per_m',         'Монтаж',                     '₽/пог.м',  'cost', 5500, 10),
  ('point_each',          'Точка (точечное крепление)', '₽/шт',     'cost', 960,  20),
  ('post_each',           'Стойка',                     '₽/шт',     'cost', 2950, 30),
  ('profile_per_m',       'Профиль зажимной',           '₽/пог.м',  'cost', 6000, 40),
  ('points_per_m',        'Точек на пог.м (правило)',   'шт/пог.м', 'rule', 4,    50),
  ('posts_per_m',         'Стоек на пог.м (правило)',   'шт/пог.м', 'rule', 1,    60),
  ('profile_reserve_pct', 'Запас профиля',              '%',        'rule', 10,   70)
on conflict (key) do nothing;

alter table public.railing_rates enable row level security;

drop policy if exists "auth_read_railing_rates"   on public.railing_rates;
create policy "auth_read_railing_rates"   on public.railing_rates
  for select using (auth.uid() is not null);

drop policy if exists "auth_update_railing_rates" on public.railing_rates;
create policy "auth_update_railing_rates" on public.railing_rates
  for update using (auth.uid() is not null) with check (auth.uid() is not null);
