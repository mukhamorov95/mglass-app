-- Лофт v2: реальный конструктив цеха (штапик с двух сторон через бонки,
-- Е-уплотнитель, сварка ₽/м², покраска ₽/печка) + фурнитура распашных/раздвижных.
-- Закупочные владельца: 40×20×1.5 = 80 ₽/пог.м, 15×15×1.5 = 40 ₽/пог.м.

update loft_rates set value = 80 where key = 'profile_40x20';
update loft_rates set value = 40 where key = 'profile_shtapik';
update loft_rates set label = 'Е-уплотнитель (оконный, на штапик)' where key = 'seal';

delete from loft_rates where key in ('weld_m', 'paint_m', 'paint_min');

insert into loft_rates (key, label, unit, value, sort) values
  ('bonka',       'Бонка + винт + сверловка (точка крепежа штапика)', '₽/точка', 30, 45),
  ('push_handle', 'Ручка нажимная с замком (покупная)',               '₽/шт',   2000, 62),
  ('track_kit',   'Раздвижная система — трек-комплект (80–100 кг)',   '₽/створка', 6000, 64),
  ('soft_close',  'Доводчик раздвижной двери',                        '₽/шт',   3500, 66),
  ('weld_m2',     'Работа сварщика',                                  '₽/м² изделия', 2000, 80),
  ('paint_oven',  'Покраска порошковая (RAL, печка)',                 '₽/печка', 8000, 90)
on conflict (key) do nothing;
