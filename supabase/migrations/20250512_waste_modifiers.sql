-- Material waste modifiers: shape/context addons applied on top of base waste_pct
CREATE TABLE IF NOT EXISTS material_waste_modifiers (
  id          serial PRIMARY KEY,
  rule_key    text NOT NULL UNIQUE,
  rule_name   text NOT NULL,
  percent_add numeric(5,1) NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  applies_to  text NOT NULL DEFAULT 'all',   -- 'glass' | 'mirror' | 'all'
  description text,
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

INSERT INTO material_waste_modifiers
  (rule_key, rule_name, percent_add, active, applies_to, description, sort_order)
VALUES
  ('round',       'Круглое изделие',        12, true, 'mirror', 'Дополнительный расход при раскрое круга',     1),
  ('oval',        'Овальное изделие',        15, true, 'mirror', 'Дополнительный расход при раскрое овала',     2),
  ('complex',     'Сложная форма',           10, true, 'all',    'Нестандартный контур',                        3),
  ('ribbed',      'Рифлёное стекло',         15, true, 'glass',  'Надбавка за рифлёную фактуру',                4),
  ('tall',        'Высота > 2600 мм',        10, true, 'all',    'Надбавка за большой лист',                    5),
  ('nonstandard', 'Нестандартный раскрой',    5, true, 'all',    'Нестандартный размер листа',                  6)
ON CONFLICT (rule_key) DO NOTHING;

-- Fill waste_pct baseline values for glass cost rows
UPDATE glass_price_matrix SET waste_pct = 20  WHERE name = 'Прозрачное М1'                   AND price_type = 'cost' AND category = 'glass';
UPDATE glass_price_matrix SET waste_pct = 25  WHERE name = 'Тонированное (бронза/графит)'    AND price_type = 'cost' AND category = 'glass';
UPDATE glass_price_matrix SET waste_pct = 25  WHERE name = 'Сатинированное бесцветное'       AND price_type = 'cost' AND category = 'glass';
UPDATE glass_price_matrix SET waste_pct = 30  WHERE name = 'Сатин тонированный'              AND price_type = 'cost' AND category = 'glass';
UPDATE glass_price_matrix SET waste_pct = 25  WHERE name = 'Осветлённое CrystalVision'       AND price_type = 'cost' AND category = 'glass';
UPDATE glass_price_matrix SET waste_pct = 30  WHERE name = 'CrystalVision Matelux'           AND price_type = 'cost' AND category = 'glass';
UPDATE glass_price_matrix SET waste_pct = 40  WHERE name = 'Рифлёное MORU не осветлённое'    AND price_type = 'cost' AND category = 'glass';
UPDATE glass_price_matrix SET waste_pct = 45  WHERE name = 'Рифлёное MORU осветлённое Ультра' AND price_type = 'cost' AND category = 'glass';

-- Default waste for mirrors
UPDATE glass_price_matrix SET waste_pct = 18 WHERE price_type = 'cost' AND category = 'mirror';

-- Populate glass_price_matrix sale tab from b2b_materials data
UPDATE glass_price_matrix SET t4=1300, t5=1500, t6=1800, t8=3258, t10=3300
  WHERE name = 'Прозрачное М1' AND price_type = 'sale' AND category = 'glass';

UPDATE glass_price_matrix SET t4=3300, t6=4600, t8=6400, t10=7800
  WHERE name = 'Осветлённое CrystalVision' AND price_type = 'sale' AND category = 'glass';

UPDATE glass_price_matrix SET t4=3100, t6=4800, t8=6600, t10=8200
  WHERE name = 'CrystalVision Matelux' AND price_type = 'sale' AND category = 'glass';

UPDATE glass_price_matrix SET t4=2500, t5=2900, t6=3300, t8=4600, t10=5700
  WHERE name = 'Сатинированное бесцветное' AND price_type = 'sale' AND category = 'glass';

UPDATE glass_price_matrix SET t4=3500, t6=5000, t8=6600, t10=7800
  WHERE name = 'Сатин тонированный' AND price_type = 'sale' AND category = 'glass';

UPDATE glass_price_matrix SET t8=17000, t10=18700
  WHERE name = 'Рифлёное MORU не осветлённое' AND price_type = 'sale' AND category = 'glass';

UPDATE glass_price_matrix SET t8=17000, t10=20250
  WHERE name = 'Рифлёное MORU осветлённое Ультра' AND price_type = 'sale' AND category = 'glass';

-- Mirror sale prices (B2B pricesheet values)
UPDATE glass_price_matrix SET t4=1950, t6=3250
  WHERE name = 'Серебро' AND price_type = 'sale' AND category = 'mirror';

UPDATE glass_price_matrix SET t4=3970, t6=5968
  WHERE name = 'Осветлённое' AND price_type = 'sale' AND category = 'mirror';

UPDATE glass_price_matrix SET t4=3460, t6=5260
  WHERE name = 'Тонированное (бронза/графит)' AND price_type = 'sale' AND category = 'mirror';
