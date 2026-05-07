-- ─── Product Line / Product Business ─────────────────────────────────────────

-- Product line groups (e.g. Shower Basic, Mirror Premium)
CREATE TABLE IF NOT EXISTS product_lines (
  id          SERIAL PRIMARY KEY,
  category    TEXT NOT NULL,        -- shower | mirror | loft | office
  line_type   TEXT NOT NULL DEFAULT 'standard', -- basic | standard | premium
  name        TEXT NOT NULL,
  tagline     TEXT,
  target_audience TEXT,
  status      TEXT NOT NULL DEFAULT 'concept', -- concept | development | active | archived
  sort_order  INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE product_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_product_lines" ON product_lines
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Individual SKUs
CREATE TABLE IF NOT EXISTS product_skus (
  id              SERIAL PRIMARY KEY,
  line_id         INT REFERENCES product_lines(id) ON DELETE SET NULL,
  sku             TEXT NOT NULL,
  name            TEXT NOT NULL,
  category        TEXT NOT NULL,
  sub_type        TEXT,           -- standing | swing | sliding | led | no_led
  width_mm        INT,
  height_mm       INT,
  depth_mm        INT,
  color           TEXT,           -- chrome | black | brushed_gold | white
  form            TEXT,           -- rectangle | round | oval
  materials       TEXT[] DEFAULT '{}',
  hardware_list   TEXT[] DEFAULT '{}',
  weight_kg       DECIMAL(6,2),
  package_dims    TEXT,
  photo_url       TEXT,
  video_url       TEXT,
  instructions_url TEXT,
  status          TEXT NOT NULL DEFAULT 'concept',
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE product_skus ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_product_skus" ON product_skus
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Unit economics per SKU (1:1)
CREATE TABLE IF NOT EXISTS product_unit_economics (
  id                     SERIAL PRIMARY KEY,
  sku_id                 INT UNIQUE REFERENCES product_skus(id) ON DELETE CASCADE,
  -- Direct costs (₽)
  cost_glass             DECIMAL(10,2) DEFAULT 0,
  cost_mirror            DECIMAL(10,2) DEFAULT 0,
  cost_hardware          DECIMAL(10,2) DEFAULT 0,
  cost_profile           DECIMAL(10,2) DEFAULT 0,
  cost_packaging         DECIMAL(10,2) DEFAULT 0,
  cost_led               DECIMAL(10,2) DEFAULT 0,
  cost_power_supply      DECIMAL(10,2) DEFAULT 0,
  cost_assembly          DECIMAL(10,2) DEFAULT 0,
  cost_installation      DECIMAL(10,2) DEFAULT 0,
  cost_delivery          DECIMAL(10,2) DEFAULT 0,
  cost_tempering         DECIMAL(10,2) DEFAULT 0,
  cost_consumables       DECIMAL(10,2) DEFAULT 0,
  cost_defects_pct       DECIMAL(5,2)  DEFAULT 2,
  -- Indirect costs (% of revenue)
  tax_pct                DECIMAL(5,2) DEFAULT 6,
  ads_pct                DECIMAL(5,2) DEFAULT 10,
  manager_commission_pct DECIMAL(5,2) DEFAULT 5,
  partner_commission_pct DECIMAL(5,2) DEFAULT 0,
  warranty_pct           DECIMAL(5,2) DEFAULT 2,
  returns_pct            DECIMAL(5,2) DEFAULT 1,
  storage_pct            DECIMAL(5,2) DEFAULT 2,
  overhead_pct           DECIMAL(5,2) DEFAULT 8,
  content_pct            DECIMAL(5,2) DEFAULT 3,
  -- Scale costs
  cac                    DECIMAL(10,2) DEFAULT 0,
  -- Manual price override (0 = auto-calculated at 40% margin)
  price_retail_override  DECIMAL(10,2) DEFAULT 0,
  updated_at             TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE product_unit_economics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_product_ue" ON product_unit_economics
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Launch checklist items per SKU
CREATE TABLE IF NOT EXISTS product_checklist_items (
  id         SERIAL PRIMARY KEY,
  sku_id     INT REFERENCES product_skus(id) ON DELETE CASCADE,
  item       TEXT NOT NULL,
  done       BOOLEAN DEFAULT false,
  sort_order INT DEFAULT 0
);

ALTER TABLE product_checklist_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_checklist" ON product_checklist_items
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Influencers
CREATE TABLE IF NOT EXISTS influencers (
  id                   SERIAL PRIMARY KEY,
  name                 TEXT NOT NULL,
  platform             TEXT NOT NULL DEFAULT 'instagram', -- instagram | youtube | tiktok | telegram
  handle               TEXT,
  url                  TEXT,
  followers            INT DEFAULT 0,
  niche                TEXT,  -- interior | lifestyle | renovation | family | design
  er_pct               DECIMAL(5,2) DEFAULT 0,
  avg_views            INT DEFAULT 0,
  cost_per_post        DECIMAL(10,2) DEFAULT 0,
  status               TEXT NOT NULL DEFAULT 'prospect', -- prospect | contacted | negotiating | active | done | pass
  city                 TEXT,
  notes                TEXT,
  created_at           TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE influencers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_influencers" ON influencers
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Influencer campaigns
CREATE TABLE IF NOT EXISTS influencer_campaigns (
  id              SERIAL PRIMARY KEY,
  influencer_id   INT REFERENCES influencers(id) ON DELETE CASCADE,
  sku_id          INT REFERENCES product_skus(id) ON DELETE SET NULL,
  title           TEXT NOT NULL,
  campaign_date   DATE,
  product_cost    DECIMAL(10,2) DEFAULT 0,
  payment         DECIMAL(10,2) DEFAULT 0,
  views           INT DEFAULT 0,
  leads           INT DEFAULT 0,
  orders          INT DEFAULT 0,
  revenue         DECIMAL(10,2) DEFAULT 0,
  content_url     TEXT,
  status          TEXT NOT NULL DEFAULT 'planned', -- planned | active | done | cancelled
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE influencer_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_influencer_campaigns" ON influencer_campaigns
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_product_skus_line ON product_skus(line_id);
CREATE INDEX IF NOT EXISTS idx_product_skus_category ON product_skus(category, status);
CREATE INDEX IF NOT EXISTS idx_influencer_campaigns_inf ON influencer_campaigns(influencer_id);

-- Seed standard product lines
INSERT INTO product_lines (category, line_type, name, tagline, status, sort_order) VALUES
  ('shower', 'basic',    'Душевая Basic',    'Надёжно. Доступно. Проверено.',  'active', 1),
  ('shower', 'standard', 'Душевая Standard', 'Оптимальное соотношение.',       'active', 2),
  ('shower', 'premium',  'Душевая Premium',  'Без компромиссов.',              'development', 3),
  ('mirror', 'basic',    'Зеркало Base',     'Чисто. Практично.',              'active', 4),
  ('mirror', 'standard', 'Зеркало Aura',     'Свет и стиль.',                  'active', 5),
  ('mirror', 'premium',  'Зеркало Frame',    'Дизайнерское решение.',          'concept', 6),
  ('loft',   'standard', 'Лофт Standard',    'Металл и стекло.',               'development', 7),
  ('loft',   'premium',  'Лофт Premium',     'Индустриальный премиум.',        'concept', 8)
ON CONFLICT DO NOTHING;
