-- Внутренние ставки B2B-калькулятора: закалка по толщинам, кромка, доставка на закалку,
-- упаковка, минимальные цены позиции. До 23.09 жили константами в lib/b2bCalculator.ts —
-- любая правка была деплоем. Правятся в /admin/b2b-rates; читает lib/b2b/rates.ts.
-- Маршрут: docs/pricing/RATES_DIRECTORY_ROUTE.md (Р1).
create table if not exists b2b_rates (
  key        text primary key,
  label      text not null,
  unit       text not null,
  value      numeric not null check (value >= 0),
  sort       int  not null default 100,
  updated_at timestamptz not null default now(),
  updated_by text
);

create or replace function b2b_rates_touch() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists b2b_rates_touch on b2b_rates;
create trigger b2b_rates_touch before update on b2b_rates
  for each row execute function b2b_rates_touch();

-- Себестоимость: партнёр не читает (владелец 22.09: «партнёр не должен видеть свою
-- себестоимость»), аноним не читает. Правят те же роли, что фацет и цены стекла.
alter table b2b_rates enable row level security;
revoke all on b2b_rates from anon;

drop policy if exists "b2b_rates_read" on b2b_rates;
create policy "b2b_rates_read" on b2b_rates
  for select to authenticated using (not is_partner());

drop policy if exists "b2b_rates_insert" on b2b_rates;
create policy "b2b_rates_insert" on b2b_rates
  for insert to authenticated with check (can_edit_pricing());

drop policy if exists "b2b_rates_update" on b2b_rates;
create policy "b2b_rates_update" on b2b_rates
  for update to authenticated using (can_edit_pricing()) with check (can_edit_pricing());
-- delete-политики нет намеренно: строку не удаляют, а правят.

-- Значения — ровно те, что были в коде: перенос места, не цены.
insert into b2b_rates (key, label, unit, value, sort, updated_by) values
  ('tempering_4',  'Закалка 4 мм',  '₽/м²', 300, 10, 'перенос из кода 23.09'),
  ('tempering_5',  'Закалка 5 мм',  '₽/м²', 350, 11, 'перенос из кода 23.09'),
  ('tempering_6',  'Закалка 6 мм',  '₽/м²', 400, 12, 'перенос из кода 23.09'),
  ('tempering_8',  'Закалка 8 мм',  '₽/м²', 500, 13, 'перенос из кода 23.09'),
  ('tempering_10', 'Закалка 10 мм', '₽/м²', 600, 14, 'перенос из кода 23.09'),
  ('tempering_12', 'Закалка 12 мм', '₽/м²', 950, 15, 'перенос из кода 23.09'),
  ('edge_per_m',          'Кромка',                 '₽/м.п.',   40,  30, 'перенос из кода 23.09'),
  ('transport_per_piece', 'Доставка на закалку',    '₽/деталь', 77,  40, 'перенос из кода 23.09'),
  ('packaging_per_m2',    'Упаковка (гофрокартон)', '₽/м²',     120, 50, 'перенос из кода 23.09'),
  ('min_glass_tempering',  'Мин. цена позиции — стекло с закалкой', '₽/шт', 2500, 60, 'перенос из кода 23.09'),
  ('min_tinted_tempering', 'Мин. цена позиции — тонированное, сатин, рифлёное, декор с закалкой', '₽/шт', 3000, 61, 'перенос из кода 23.09'),
  ('min_mirror',           'Мин. цена позиции — зеркало без закалки', '₽/шт', 1500, 62, 'перенос из кода 23.09'),
  ('min_narrow_detail',    'Мин. цена позиции — узкая деталь (сторона < 250 мм)', '₽/шт', 1500, 63, 'перенос из кода 23.09')
on conflict (key) do nothing;
