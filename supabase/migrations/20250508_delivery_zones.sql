-- Delivery zones with price tiers
CREATE TABLE IF NOT EXISTS delivery_zones (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text,
  price       numeric(10,2) NOT NULL DEFAULT 0,
  sort_order  int NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Seed default zones
INSERT INTO delivery_zones (name, description, price, sort_order) VALUES
  ('В пределах МКАД',  'Доставка по Москве',              2500, 1),
  ('До 10 км от МКАД', 'Ближнее Подмосковье',             3500, 2),
  ('10–30 км от МКАД', 'Среднее Подмосковье',             5000, 3),
  ('30–50 км от МКАД', 'Дальнее Подмосковье',             7000, 4),
  ('Более 50 км',      'Уточняется индивидуально',        0,    5),
  ('Самовывоз',        'Клиент забирает сам, бесплатно',  0,    6)
ON CONFLICT DO NOTHING;
