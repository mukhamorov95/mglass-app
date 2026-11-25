-- Вырезы в стекле (владелец 25.11.2026): 4 строки справочника услуг с кодом.
-- Цены пустые: себестоимость и продажу ставит Вера на /admin/cutouts; пока продажа 0,
-- калькулятор позицию с таким вырезом не добавляет.
alter table b2b_services add column if not exists code text;
create unique index if not exists b2b_services_code_key on b2b_services (code) where code is not null;

insert into b2b_services (code, name, type, value, cost_price, unit_label, description, active, sort_order)
select v.code, v.name, 'fixed', 0, 0, '₽/шт', v.descr, true, v.ord
from (values
  ('cutout_outer_1', 'Вырез внешний I категории',   'Вырез по краю стекла, простой', 40),
  ('cutout_outer_2', 'Вырез внешний II категории',  'Вырез по краю стекла, сложный', 41),
  ('cutout_inner_1', 'Вырез внутренний I категории', 'Вырез внутри поля стекла, простой', 42),
  ('cutout_inner_2', 'Вырез внутренний II категории','Вырез внутри поля стекла, сложный', 43)
) as v(code, name, descr, ord)
where not exists (select 1 from b2b_services s where s.code = v.code);
