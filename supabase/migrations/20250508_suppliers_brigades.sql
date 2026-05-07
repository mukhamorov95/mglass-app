-- Suppliers directory
CREATE TABLE IF NOT EXISTS suppliers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  contact     text,
  phone       text,
  email       text,
  materials   text,
  notes       text,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Brigades / installers
CREATE TABLE IF NOT EXISTS brigades (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  lead_name     text,
  phone         text,
  specialization text[],
  active        boolean NOT NULL DEFAULT true,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Installer ratings
CREATE TABLE IF NOT EXISTS installer_ratings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid REFERENCES orders(id) ON DELETE SET NULL,
  brigade_id  uuid REFERENCES brigades(id) ON DELETE SET NULL,
  rating      int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
