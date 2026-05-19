-- ── Справочник плёнок для B2B калькулятора ────────────────────────────────────
CREATE TABLE IF NOT EXISTS b2b_films (
  id                  BIGSERIAL     PRIMARY KEY,
  name                TEXT          NOT NULL,
  cost_price_per_m2   NUMERIC(12,2) NOT NULL DEFAULT 0,
  sale_price_per_m2   NUMERIC(12,2) NOT NULL DEFAULT 0,
  description         TEXT,
  active              BOOLEAN       NOT NULL DEFAULT true,
  sort_order          INT           NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT now()
);

ALTER TABLE b2b_films ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth read b2b_films"
  ON b2b_films FOR SELECT TO authenticated USING (true);

CREATE POLICY "Auth manage b2b_films"
  ON b2b_films FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Добавить тип 'film' в b2b_services
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'b2b_services'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%type%'
  LOOP
    EXECUTE 'ALTER TABLE b2b_services DROP CONSTRAINT ' || quote_ident(r.conname);
  END LOOP;
END $$;

ALTER TABLE b2b_services
  ADD CONSTRAINT b2b_services_type_check
  CHECK (type IN ('percent', 'per_m2', 'fixed', 'calculated', 'film'));

-- Добавить услугу "Приклейка плёнки" если её нет
INSERT INTO b2b_services (name, type, value, cost_price, description, active, sort_order, unit_label)
VALUES ('Приклейка плёнки', 'film', 0, 0, 'Цена зависит от выбранной плёнки × площадь м²', true, 90, '₽/м²')
ON CONFLICT DO NOTHING;
