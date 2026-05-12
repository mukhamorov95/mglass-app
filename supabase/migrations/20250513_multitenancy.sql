-- ─── Multi-tenancy: organizations + profiles + org scoping ───────────────────
-- Strategy: every tenant gets an organization row. All B2B tables get an
-- organization_id FK. Existing records are backfilled to org 1 ("MGlass").
-- RLS uses auth.org_id() which reads the current user's profile. The DEFAULT 1
-- on every column means old code paths that don't set organization_id still work.

-- ── 1. Organizations ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organizations (
  id         BIGSERIAL   PRIMARY KEY,
  name       TEXT        NOT NULL,
  slug       TEXT        UNIQUE,
  plan       TEXT        NOT NULL DEFAULT 'standard',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the default org so existing FKs resolve to a real row
INSERT INTO organizations (id, name, slug, plan)
VALUES (1, 'MGlass', 'mglass', 'standard')
ON CONFLICT (id) DO NOTHING;

-- Keep the sequence ahead of the seeded row
SELECT setval('organizations_id_seq', GREATEST(1, (SELECT MAX(id) FROM organizations)));

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can read their org"
  ON organizations FOR SELECT TO authenticated
  USING (id = auth.org_id());

CREATE POLICY "Auth users can create orgs"
  ON organizations FOR INSERT TO authenticated
  WITH CHECK (true);

-- ── 2. Profiles (user → org mapping + role) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  user_id         UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id BIGINT      NOT NULL DEFAULT 1 REFERENCES organizations(id),
  role            TEXT        NOT NULL DEFAULT 'manager',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profiles_org ON profiles(organization_id);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own profile"
  ON profiles FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can create their own profile"
  ON profiles FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update their own profile"
  ON profiles FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── 3. Helper: current user's org id (cached per transaction) ─────────────────
-- Used in all RLS policies below. Falls back to 1 so pre-migration users see data.
CREATE OR REPLACE FUNCTION auth.org_id() RETURNS BIGINT AS $$
  SELECT COALESCE(
    (SELECT organization_id FROM public.profiles WHERE user_id = auth.uid()),
    1
  )
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- ── 4. Add organization_id to core B2B tables ─────────────────────────────────

-- b2b_clients
ALTER TABLE b2b_clients
  ADD COLUMN IF NOT EXISTS organization_id BIGINT NOT NULL DEFAULT 1 REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_b2b_clients_org ON b2b_clients(organization_id);
UPDATE b2b_clients SET organization_id = 1 WHERE organization_id IS NULL OR organization_id = 0;

-- b2b_orders
ALTER TABLE b2b_orders
  ADD COLUMN IF NOT EXISTS organization_id BIGINT NOT NULL DEFAULT 1 REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_b2b_orders_org ON b2b_orders(organization_id);
UPDATE b2b_orders SET organization_id = 1 WHERE organization_id IS NULL OR organization_id = 0;

-- b2b_interactions
ALTER TABLE b2b_interactions
  ADD COLUMN IF NOT EXISTS organization_id BIGINT NOT NULL DEFAULT 1 REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_b2b_interactions_org ON b2b_interactions(organization_id);
UPDATE b2b_interactions SET organization_id = 1 WHERE organization_id IS NULL OR organization_id = 0;

-- b2b_leads
ALTER TABLE b2b_leads
  ADD COLUMN IF NOT EXISTS organization_id BIGINT NOT NULL DEFAULT 1 REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_b2b_leads_org ON b2b_leads(organization_id);
UPDATE b2b_leads SET organization_id = 1 WHERE organization_id IS NULL OR organization_id = 0;

-- b2b_lead_activities
ALTER TABLE b2b_lead_activities
  ADD COLUMN IF NOT EXISTS organization_id BIGINT NOT NULL DEFAULT 1 REFERENCES organizations(id);
UPDATE b2b_lead_activities SET organization_id = 1 WHERE organization_id IS NULL OR organization_id = 0;

-- b2b_outreach_templates
ALTER TABLE b2b_outreach_templates
  ADD COLUMN IF NOT EXISTS organization_id BIGINT NOT NULL DEFAULT 1 REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_b2b_outreach_org ON b2b_outreach_templates(organization_id);
UPDATE b2b_outreach_templates SET organization_id = 1 WHERE organization_id IS NULL OR organization_id = 0;

-- glass_price_matrix
ALTER TABLE glass_price_matrix
  ADD COLUMN IF NOT EXISTS organization_id BIGINT NOT NULL DEFAULT 1 REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_glass_price_matrix_org ON glass_price_matrix(organization_id);
UPDATE glass_price_matrix SET organization_id = 1 WHERE organization_id IS NULL OR organization_id = 0;

-- ── 5. RLS policies on B2B tables ─────────────────────────────────────────────
-- Pattern: read/write only within your org. The DEFAULT 1 on inserts means
-- old code paths still write to org 1, which existing users will see.

-- b2b_clients
DROP POLICY IF EXISTS "Auth manage b2b_clients" ON b2b_clients;
CREATE POLICY "Org tenant b2b_clients"
  ON b2b_clients FOR ALL TO authenticated
  USING (organization_id = auth.org_id())
  WITH CHECK (organization_id = auth.org_id());

-- b2b_orders
DROP POLICY IF EXISTS "Auth manage b2b_orders" ON b2b_orders;
CREATE POLICY "Org tenant b2b_orders"
  ON b2b_orders FOR ALL TO authenticated
  USING (organization_id = auth.org_id())
  WITH CHECK (organization_id = auth.org_id());

-- b2b_interactions
DROP POLICY IF EXISTS "Auth manage b2b_interactions" ON b2b_interactions;
CREATE POLICY "Org tenant b2b_interactions"
  ON b2b_interactions FOR ALL TO authenticated
  USING (organization_id = auth.org_id())
  WITH CHECK (organization_id = auth.org_id());

-- b2b_leads
DROP POLICY IF EXISTS "Auth manage b2b_leads" ON b2b_leads;
CREATE POLICY "Org tenant b2b_leads"
  ON b2b_leads FOR ALL TO authenticated
  USING (organization_id = auth.org_id())
  WITH CHECK (organization_id = auth.org_id());

-- b2b_outreach_templates
DROP POLICY IF EXISTS "Auth manage b2b_outreach_templates" ON b2b_outreach_templates;
CREATE POLICY "Org tenant b2b_outreach_templates"
  ON b2b_outreach_templates FOR ALL TO authenticated
  USING (organization_id = auth.org_id())
  WITH CHECK (organization_id = auth.org_id());

-- glass_price_matrix
DROP POLICY IF EXISTS "Auth read glass_price_matrix" ON glass_price_matrix;
DROP POLICY IF EXISTS "Auth manage glass_price_matrix" ON glass_price_matrix;
CREATE POLICY "Org tenant glass_price_matrix"
  ON glass_price_matrix FOR ALL TO authenticated
  USING (organization_id = auth.org_id())
  WITH CHECK (organization_id = auth.org_id());
