-- Owner strategic questionnaire answers
CREATE TABLE IF NOT EXISTS owner_strategy (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- RLS: only admins can read/write
ALTER TABLE owner_strategy ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all" ON owner_strategy
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
  );

-- Seed with empty defaults so keys exist
INSERT INTO owner_strategy (key, value) VALUES
  ('target_margin',            '40'),
  ('min_margin',               '25'),
  ('monthly_revenue_target',   '3000000'),
  ('max_manager_discount',     '10'),
  ('warranty_days',            '365'),
  ('scrap_rate',               '5'),
  ('lead_time_standard',       '7'),
  ('lead_time_express',        '3'),
  ('b2b_min_order',            '50000'),
  ('new_clients_monthly',      '20'),
  ('price_positioning',        'same'),
  ('installation_mode',        'own'),
  ('peak_months',              '4,5,9,10,11'),
  ('top_product_priority',     'shower'),
  ('growth_priority',          '')
ON CONFLICT (key) DO NOTHING;
