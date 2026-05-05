-- Средние рыночные цены закупки фурнитуры для лофт-перегородок

-- Обновляем существующие позиции
update public.hardware_items set cost_price = 1200 where name = 'Ролик раздвижной';
update public.hardware_items set cost_price = 1800 where name = 'Трек раздвижной';
update public.hardware_items set cost_price =  400 where name = 'Стопор';
update public.hardware_items set cost_price = 1500 where name = 'Доводчик';
update public.hardware_items set cost_price =  900 where name = 'Петля';
update public.hardware_items set cost_price = 1000 where name = 'Ручка';
update public.hardware_items set cost_price = 1200 where name = 'Замок';

-- Добавляем недостающие позиции (если ещё нет)
insert into public.hardware_items (name, system_type, unit, cost_price) values
  ('Нижний направляющий ролик', 'sliding',   'шт',    600),
  ('Щёточный уплотнитель',      'sliding',   'пог.м', 280),
  ('Ручка-скоба',               'universal', 'шт',    800),
  ('Петля угловая',             'swing',     'шт',   1100),
  ('Замок-защёлка',             'swing',     'шт',    750)
on conflict do nothing;
