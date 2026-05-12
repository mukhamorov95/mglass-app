CREATE TABLE IF NOT EXISTS glass_price_matrix (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text        NOT NULL,
  sort_order  int         NOT NULL DEFAULT 0,
  price_type  text        NOT NULL DEFAULT 'cost' CHECK (price_type IN ('cost', 'sale')),
  t4          int,
  t5          int,
  t6          int,
  t8          int,
  t10         int,
  t12         int,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, price_type)
);

CREATE INDEX IF NOT EXISTS idx_glass_price_matrix_type ON glass_price_matrix (price_type);
