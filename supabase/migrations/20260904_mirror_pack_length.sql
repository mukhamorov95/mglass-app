-- Кратность расходников подсветки (маршрут З4).
-- Лента продаётся бухтами по 5 м, профиль/рассеиватель — хлыстами по 6 м:
-- нужно 3 м → платим за целую бухту. Без этого поля расчёт считал погонные
-- метры и систематически занижал.
alter table public.mirror_lighting_components add column if not exists pack_length_m numeric;
comment on column public.mirror_lighting_components.pack_length_m is 'Длина бухты/хлыста в метрах: платим за целую упаковку. null — штучная позиция';

update public.mirror_lighting_components set pack_length_m = 5 where component_type = 'led_strip' and pack_length_m is null;
update public.mirror_lighting_components set pack_length_m = 6 where component_type in ('frame','diffuser') and pack_length_m is null;

-- Позиции подсветки заводятся по видам (решение владельца: никаких «расходников»
-- одной строкой). Вкладки справочника — кнопка, сенсор, провод, коннекторы, диммер.
insert into public.mirror_lighting_tabs (value, label, sort_order) values
  ('button',    'Кнопка',     110),
  ('sensor',    'Сенсор',     120),
  ('wire',      'Провод',     130),
  ('connector', 'Коннекторы', 140),
  ('dimmer',    'Диммер',     150)
on conflict do nothing;
