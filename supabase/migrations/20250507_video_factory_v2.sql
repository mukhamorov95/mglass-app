-- ─── Video Factory V2 ────────────────────────────────────────────────────────

-- Full AI-generated content scripts
CREATE TABLE IF NOT EXISTS marketing_scripts (
  id                SERIAL PRIMARY KEY,
  content_type      TEXT NOT NULL DEFAULT 'reels',
  topic             TEXT NOT NULL,
  goal              TEXT NOT NULL,
  context_input     TEXT,
  title             TEXT,
  hook              TEXT,
  structure         JSONB,
  narrator_text     TEXT,
  shots             JSONB,
  b_roll            TEXT[],
  editing_notes     TEXT,
  subtitle_moments  TEXT[],
  cta               TEXT,
  description       TEXT,
  cover_idea        TEXT,
  telegram_post     TEXT,
  whatsapp_status   TEXT,
  b2b_version       TEXT,
  views_count       INT NOT NULL DEFAULT 0,
  leads_count       INT NOT NULL DEFAULT 0,
  saves_count       INT NOT NULL DEFAULT 0,
  platform_url      TEXT,
  status            TEXT NOT NULL DEFAULT 'idea',
  ai_generated      BOOLEAN NOT NULL DEFAULT false,
  created_by        UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE marketing_scripts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_scripts_v2" ON marketing_scripts
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Media library
CREATE TABLE IF NOT EXISTS marketing_media (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL DEFAULT 'photo',
  url             TEXT,
  thumbnail_url   TEXT,
  tags            TEXT[] DEFAULT '{}',
  category        TEXT,
  description     TEXT,
  project_name    TEXT,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE marketing_media ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_media" ON marketing_media
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Daily AI content cache
CREATE TABLE IF NOT EXISTS marketing_daily_ai (
  id           SERIAL PRIMARY KEY,
  date         DATE NOT NULL DEFAULT CURRENT_DATE,
  content_type TEXT NOT NULL,
  content      JSONB NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (date, content_type)
);

ALTER TABLE marketing_daily_ai ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_all_daily" ON marketing_daily_ai
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Index for fast date lookups
CREATE INDEX IF NOT EXISTS idx_marketing_daily_date ON marketing_daily_ai (date DESC);
CREATE INDEX IF NOT EXISTS idx_marketing_scripts_status ON marketing_scripts (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketing_media_tags ON marketing_media USING GIN (tags);
