-- ─── Marketing Center ────────────────────────────────────────────────────────

-- Content plan
CREATE TABLE IF NOT EXISTS marketing_content (
  id           SERIAL PRIMARY KEY,
  category     TEXT NOT NULL,
  topic        TEXT NOT NULL,
  goal         TEXT,
  platform     TEXT,
  hook         TEXT,
  body         TEXT,
  video_idea   TEXT,
  cta          TEXT,
  status       TEXT NOT NULL DEFAULT 'idea',
  publish_date DATE,
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE marketing_content ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_content" ON marketing_content USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- Video factory
CREATE TABLE IF NOT EXISTS marketing_videos (
  id             SERIAL PRIMARY KEY,
  title          TEXT NOT NULL,
  hook           TEXT,
  problem        TEXT,
  structure      TEXT,
  narrator_text  TEXT,
  shots          TEXT,
  b_roll         TEXT,
  cta            TEXT,
  status         TEXT NOT NULL DEFAULT 'idea',
  created_by     UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE marketing_videos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_videos" ON marketing_videos USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- Partners (designers, foremen, builders)
CREATE TABLE IF NOT EXISTS marketing_partners (
  id                  SERIAL PRIMARY KEY,
  name                TEXT NOT NULL,
  type                TEXT NOT NULL DEFAULT 'designer',
  phone               TEXT,
  email               TEXT,
  company             TEXT,
  instagram           TEXT,
  commission_percent  NUMERIC NOT NULL DEFAULT 5,
  status              TEXT NOT NULL DEFAULT 'active',
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE marketing_partners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_partners" ON marketing_partners USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- Partner referrals
CREATE TABLE IF NOT EXISTS marketing_partner_referrals (
  id               SERIAL PRIMARY KEY,
  partner_id       INT NOT NULL REFERENCES marketing_partners(id) ON DELETE CASCADE,
  client_name      TEXT,
  client_phone     TEXT,
  product          TEXT,
  order_amount     NUMERIC,
  commission_amount NUMERIC,
  status           TEXT NOT NULL DEFAULT 'pending',
  order_date       DATE,
  paid_at          DATE,
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE marketing_partner_referrals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_referrals" ON marketing_partner_referrals USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- Promotions
CREATE TABLE IF NOT EXISTS marketing_promos (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL DEFAULT 'discount',
  description     TEXT,
  discount_value  NUMERIC,
  conditions      TEXT,
  target          TEXT NOT NULL DEFAULT 'all',
  start_date      DATE,
  end_date        DATE,
  active          BOOLEAN NOT NULL DEFAULT true,
  margin_safe     BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE marketing_promos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_promos" ON marketing_promos USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- Marketing tasks
CREATE TABLE IF NOT EXISTS marketing_tasks (
  id           SERIAL PRIMARY KEY,
  title        TEXT NOT NULL,
  direction    TEXT NOT NULL DEFAULT 'content',
  priority     TEXT NOT NULL DEFAULT 'normal',
  assignee     TEXT,
  deadline     DATE,
  status       TEXT NOT NULL DEFAULT 'todo',
  result       TEXT,
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE marketing_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_tasks" ON marketing_tasks USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- ─── Seed ────────────────────────────────────────────────────────────────────

INSERT INTO marketing_promos (name, type, description, discount_value, conditions, target, margin_safe) VALUES
  ('Бесплатный замер',       'free_measurement', 'Выезд замерщика при заказе от 30 000 ₽',          NULL,  'Заказ от 30 000 ₽',           'b2c',      true),
  ('Бесплатная доставка',    'free_delivery',    'Доставка в подарок при заказе от 50 000 ₽',        NULL,  'Заказ от 50 000 ₽',           'b2c',      true),
  ('−10% на монтаж',         'discount',         'Скидка 10% на монтаж при повторном заказе',        10,    'Повторный клиент',            'b2c',      true),
  ('Бонус дизайнеру 5%',     'partner_bonus',    'Дизайнер получает 5% от суммы заказа',             5,     'Партнёр-дизайнер',           'designer', true),
  ('B2B тестовый заказ',     'b2b_trial',        'Первый B2B заказ по спецценам для новых клиентов', NULL,  'Первый заказ от нового B2B',  'b2b',      true)
ON CONFLICT DO NOTHING;

INSERT INTO marketing_tasks (title, direction, priority, status) VALUES
  ('Снять 5 видео с производства',         'content',  'high',   'todo'),
  ('Собрать 20 фото монтажей душевых',     'content',  'high',   'todo'),
  ('Сделать PDF-оффер для дизайнеров',     'partners', 'high',   'todo'),
  ('Собрать базу 100 прорабов',            'b2b',      'normal', 'todo'),
  ('Подготовить B2B прайс-лист PDF',       'b2b',      'normal', 'todo'),
  ('Запустить серию Reels "До/после"',     'content',  'high',   'todo'),
  ('Создать Telegram-канал для партнёров', 'partners', 'normal', 'todo'),
  ('Снять ролик "Почему мы дороже"',       'content',  'high',   'todo')
ON CONFLICT DO NOTHING;
