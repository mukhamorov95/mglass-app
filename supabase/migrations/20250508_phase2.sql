-- Phase 2 migrations

-- 1. Delivery address on orders
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_address text;

-- 2. Completion photos (array of URLs)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS completion_photos text[] NOT NULL DEFAULT '{}';

-- 3. SLA config on financial_settings (days before alert)
ALTER TABLE financial_settings
  ADD COLUMN IF NOT EXISTS sla_days_approved  int NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS sla_days_in_work   int NOT NULL DEFAULT 21;

-- 4. Appointments (calendar of measurements + installations)
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

-- 5. Warehouse: stock qty on materials
ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS stock_qty    numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS min_stock_qty numeric(10,2) NOT NULL DEFAULT 0;

-- 6. Measurements (measurer form submissions)
CREATE TABLE IF NOT EXISTS measurements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid REFERENCES orders(id) ON DELETE SET NULL,
  client_name text NOT NULL,
  address     text,
  phone       text,
  product_type text,
  dimensions  jsonb,
  photos      text[] NOT NULL DEFAULT '{}',
  notes       text,
  submitted_by uuid REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
