-- ============================================================
-- ALL PENDING MIGRATIONS — run this once in Supabase SQL Editor
-- ============================================================

-- 1. financial_settings: max discount limit
ALTER TABLE financial_settings
  ADD COLUMN IF NOT EXISTS max_discount_percent numeric(5,2) NOT NULL DEFAULT 15;

-- 2. financial_settings: SLA days
ALTER TABLE financial_settings
  ADD COLUMN IF NOT EXISTS sla_days_approved int NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS sla_days_in_work  int NOT NULL DEFAULT 21;

-- 3. orders: payment tracking
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_status    text          NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS prepayment_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prepayment_date   date,
  ADD COLUMN IF NOT EXISTS payment_notes     text;

ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_payment_status_check;
ALTER TABLE orders
  ADD CONSTRAINT orders_payment_status_check
  CHECK (payment_status IN ('unpaid', 'partial', 'paid'));

-- 4. orders: delivery address + completion photos
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_address  text,
  ADD COLUMN IF NOT EXISTS completion_photos text[] NOT NULL DEFAULT '{}';

-- 5. orders: production stages
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS production_stages jsonb NOT NULL DEFAULT '{}';

-- 6. materials: stock quantities
ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS stock_qty     numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS min_stock_qty numeric(10,2) NOT NULL DEFAULT 0;

-- 7. suppliers
CREATE TABLE IF NOT EXISTS suppliers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  contact    text,
  phone      text,
  email      text,
  materials  text,
  notes      text,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 8. brigades
CREATE TABLE IF NOT EXISTS brigades (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  lead_name      text,
  phone          text,
  specialization text[],
  active         boolean NOT NULL DEFAULT true,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- 9. installer_ratings
CREATE TABLE IF NOT EXISTS installer_ratings (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   uuid REFERENCES orders(id) ON DELETE SET NULL,
  brigade_id uuid REFERENCES brigades(id) ON DELETE SET NULL,
  rating     int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment    text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 10. delivery_zones
CREATE TABLE IF NOT EXISTS delivery_zones (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text,
  price       numeric(10,2) NOT NULL DEFAULT 0,
  sort_order  int NOT NULL DEFAULT 0,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO delivery_zones (name, description, price, sort_order) VALUES
  ('В пределах МКАД',  'Доставка по Москве',             2500, 1),
  ('До 10 км от МКАД', 'Ближнее Подмосковье',            3500, 2),
  ('10–30 км от МКАД', 'Среднее Подмосковье',            5000, 3),
  ('30–50 км от МКАД', 'Дальнее Подмосковье',            7000, 4),
  ('Более 50 км',      'Уточняется индивидуально',           0, 5),
  ('Самовывоз',        'Клиент забирает сам, бесплатно',     0, 6)
ON CONFLICT DO NOTHING;

-- 11. appointments
CREATE TABLE IF NOT EXISTS appointments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      uuid REFERENCES orders(id) ON DELETE SET NULL,
  type          text NOT NULL CHECK (type IN ('measurement', 'installation')),
  scheduled_at  timestamptz NOT NULL,
  address       text,
  assignee_name text,
  notes         text,
  status        text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'done', 'cancelled')),
  created_by    uuid REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- 12. measurements
CREATE TABLE IF NOT EXISTS measurements (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id     uuid REFERENCES orders(id) ON DELETE SET NULL,
  client_name  text NOT NULL,
  address      text,
  phone        text,
  product_type text,
  dimensions   jsonb,
  photos       text[] NOT NULL DEFAULT '{}',
  notes        text,
  submitted_by uuid REFERENCES auth.users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- 13. orders: link to delivery_zones and brigades
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_zone_id uuid REFERENCES delivery_zones(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delivery_cost    numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS brigade_id       uuid REFERENCES brigades(id) ON DELETE SET NULL;

-- 14. indexes
CREATE INDEX IF NOT EXISTS idx_orders_manager_id    ON orders(manager_id);
CREATE INDEX IF NOT EXISTS idx_orders_status         ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at     ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_brigade_id     ON orders(brigade_id);
CREATE INDEX IF NOT EXISTS idx_orders_delivery_zone  ON orders(delivery_zone_id);
CREATE INDEX IF NOT EXISTS idx_order_lines_order_id  ON order_lines(order_id);
CREATE INDEX IF NOT EXISTS idx_calculations_by       ON calculations(created_by);
CREATE INDEX IF NOT EXISTS idx_calculations_at       ON calculations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ratings_order_id      ON installer_ratings(order_id);
CREATE INDEX IF NOT EXISTS idx_ratings_brigade_id    ON installer_ratings(brigade_id);
CREATE INDEX IF NOT EXISTS idx_appointments_order    ON appointments(order_id);
CREATE INDEX IF NOT EXISTS idx_appointments_date     ON appointments(scheduled_at);
