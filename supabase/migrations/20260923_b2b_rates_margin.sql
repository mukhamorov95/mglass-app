-- Пороги маржи B2B — в справочник b2b_rates (маршрут docs/pricing/RATES_DIRECTORY_ROUTE.md, Р2).
-- До 23.09: 35/25 в коде калькулятора, карточки сделки и списка просчётов, и отдельно
-- MIN_MARGIN_PERCENT = 25 в lib/b2b/priceOverride.ts — порог согласования цены.
-- Теперь одна строка margin_min и для красного цвета, и для согласования.
insert into b2b_rates (key, label, unit, value, sort, updated_by) values
  ('margin_target', 'Маржа — цель (зелёный от)', '%', 35, 70, 'перенос из кода 23.09'),
  ('margin_min',    'Маржа — нижний порог (ниже — красный и согласование цены)', '%', 25, 71, 'перенос из кода 23.09')
on conflict (key) do nothing;
