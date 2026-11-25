-- Отверстия по диаметру и толщине стекла (владелец 25.11.2026: «считаем отдельно, как БСК»).
-- Стартовая продажа — клиентский прайс БСК от 15.01.2026 со скидкой 15 %; себестоимость ставит Вера.
create table if not exists b2b_hole_prices (
  id serial primary key,
  d_max int not null,          -- диаметр до, мм включительно; полоса начинается после предыдущей
  t_max int not null,          -- толщина стекла до, мм включительно
  sale numeric not null default 0,
  cost numeric not null default 0,
  updated_at timestamptz not null default now(),
  unique (d_max, t_max)
);
alter table b2b_hole_prices enable row level security;
drop policy if exists b2b_hole_prices_read on b2b_hole_prices;
create policy b2b_hole_prices_read on b2b_hole_prices for select to authenticated using (true);

insert into b2b_hole_prices (d_max, t_max, sale) values
  (12, 6, 80), (30, 6, 107), (45, 6, 179), (90, 6, 241),
  (12, 19, 89), (30, 19, 151), (45, 19, 223), (90, 19, 268)
on conflict (d_max, t_max) do nothing;
