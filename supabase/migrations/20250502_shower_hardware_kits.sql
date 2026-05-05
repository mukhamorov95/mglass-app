-- Комплекты фурнитуры для душевых перегородок: модель × цвет → закупочная цена
-- Данные на основе анализа рынка (берустекло.ру)
-- Множители цветов: хром ×1.0, чёрный ×1.2, бронза/золото/белый ×1.3

create table if not exists public.shower_hardware_kits (
  id          bigserial primary key,
  model_id    text      not null,   -- M1, M2, ... M12
  color       text      not null,   -- chrome, black, bronze, gold, white
  cost_price  numeric   not null default 0,
  active      boolean   not null default true,
  constraint shower_hardware_kits_unique unique (model_id, color)
);

insert into public.shower_hardware_kits (model_id, color, cost_price) values
  -- M1: стационарная панель (база хром 8 195)
  ('M1',  'chrome',  8195),
  ('M1',  'black',   9834),
  ('M1',  'bronze', 10654),
  ('M1',  'gold',   10654),
  ('M1',  'white',  10654),

  -- M2: неподвижное + распашная дверь (база хром 17 190)
  ('M2',  'chrome', 17190),
  ('M2',  'black',  20628),
  ('M2',  'bronze', 22347),
  ('M2',  'gold',   22347),
  ('M2',  'white',  22347),

  -- M3: распашная дверь + неподвижное (аналог M2)
  ('M3',  'chrome', 17190),
  ('M3',  'black',  20628),
  ('M3',  'bronze', 22347),
  ('M3',  'gold',   22347),
  ('M3',  'white',  22347),

  -- M4: 2 неподвижных + распашная дверь (аналог M7, 3 элемента)
  ('M4',  'chrome', 21225),
  ('M4',  'black',  25470),
  ('M4',  'bronze', 27593),
  ('M4',  'gold',   27593),
  ('M4',  'white',  27593),

  -- M5: только распашная дверь (база хром 10 210)
  ('M5',  'chrome', 10210),
  ('M5',  'black',  12252),
  ('M5',  'bronze', 13273),
  ('M5',  'gold',   13273),
  ('M5',  'white',  13273),

  -- M6: угловая, панель + дверь (база хром 17 773)
  ('M6',  'chrome', 17773),
  ('M6',  'black',  21328),
  ('M6',  'bronze', 23105),
  ('M6',  'gold',   23105),
  ('M6',  'white',  23105),

  -- M7: угловая, 2 панели + дверь (база хром 21 225)
  ('M7',  'chrome', 21225),
  ('M7',  'black',  25470),
  ('M7',  'bronze', 27593),
  ('M7',  'gold',   27593),
  ('M7',  'white',  27593),

  -- M8: угловая раздвижная (база хром 30 390)
  ('M8',  'chrome', 30390),
  ('M8',  'black',  36468),
  ('M8',  'bronze', 39507),
  ('M8',  'gold',   39507),
  ('M8',  'white',  39507),

  -- M9: угловая раздвижная + 2 панели (аналог M7)
  ('M9',  'chrome', 21225),
  ('M9',  'black',  25470),
  ('M9',  'bronze', 27593),
  ('M9',  'gold',   27593),
  ('M9',  'white',  27593),

  -- M10: раздвижная прямая (аналог M2 по сложности)
  ('M10', 'chrome', 17190),
  ('M10', 'black',  20628),
  ('M10', 'bronze', 22347),
  ('M10', 'gold',   22347),
  ('M10', 'white',  22347),

  -- M11: трапециевидная с дверью (аналог M2)
  ('M11', 'chrome', 17190),
  ('M11', 'black',  20628),
  ('M11', 'bronze', 22347),
  ('M11', 'gold',   22347),
  ('M11', 'white',  22347),

  -- M12: раздвижная (вариант, аналог M10)
  ('M12', 'chrome', 17190),
  ('M12', 'black',  20628),
  ('M12', 'bronze', 22347),
  ('M12', 'gold',   22347),
  ('M12', 'white',  22347)

on conflict (model_id, color) do update set cost_price = excluded.cost_price;
