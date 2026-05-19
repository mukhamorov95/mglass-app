CREATE TABLE IF NOT EXISTS mirror_lighting_tabs (
  id         SERIAL PRIMARY KEY,
  value      TEXT NOT NULL UNIQUE,
  label      TEXT NOT NULL,
  sort_order INT  DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE mirror_lighting_tabs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone read tabs"  ON mirror_lighting_tabs FOR SELECT USING (true);
CREATE POLICY "Auth manage tabs"  ON mirror_lighting_tabs FOR ALL TO authenticated USING (true) WITH CHECK (true);
