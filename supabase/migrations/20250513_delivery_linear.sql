-- Linear delivery pricing (base + per km from MKAD)
-- section = 'delivery', used by all three B2C calculators and admin delivery-zones page

INSERT INTO pricing_formula (section, param_key, param_name, value, unit, sort_order)
VALUES
  ('delivery', 'base_price',   'Базовая стоимость доставки', 2000, '₽',    1),
  ('delivery', 'price_per_km', 'Стоимость 1 км от МКАД',      50,  '₽/км', 2)
ON CONFLICT (section, param_key) DO UPDATE SET value = EXCLUDED.value;
