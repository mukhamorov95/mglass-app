-- Вид позиции подсветки задаётся справочником вкладок, а не зашит в схему.
--
-- Было: CHECK разрешал только frame/led_strip/power_supply/diffuser, при этом
-- админка позволяет заводить свои вкладки (mirror_lighting_tabs) — и строка в
-- такой вкладке не сохранялась, падала ограничением. Скрытая поломка: экран
-- предлагает действие, которое база запрещает.
alter table public.mirror_lighting_components
  drop constraint if exists mirror_lighting_components_component_type_check;

alter table public.mirror_lighting_components
  add constraint mirror_lighting_components_component_type_check
  check (length(btrim(component_type)) > 0);

-- Заготовки под позиции, которых калькулятору зеркал не хватает. Выключены и с
-- нулевой ценой: движок их не возьмёт (он читает только active), а владелец
-- видит, что именно надо заполнить, вместо пустых вкладок.
insert into public.mirror_lighting_components (component_type, name, description, unit, cost_price, active, sort_order) values
  ('button',    'Кнопка-выключатель — заполнить',    'Впишите название и закупочную цену, затем включите', 'шт', 0, false, 10),
  ('sensor',    'Сенсорный выключатель — заполнить', 'Впишите название и закупочную цену, затем включите', 'шт', 0, false, 10),
  ('wire',      'Провод питания — заполнить',        'Цена за метр; если берём бухтой — укажите её длину',  'м',  0, false, 10),
  ('connector', 'Коннектор для ленты — заполнить',   'Впишите название и закупочную цену, затем включите', 'шт', 0, false, 10),
  ('dimmer',    'Диммер — заполнить',                'Впишите название и закупочную цену, затем включите', 'шт', 0, false, 10);
