-- ── System sections migration ─────────────────────────────────────────────────
-- Adds amo_user_id, can_view_all_deals to users
-- Adds commercial role
-- Creates sales_monitor_daily for historical manager stats

-- Link app user to AmoCRM user ID (set by admin)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS amo_user_id bigint,
  ADD COLUMN IF NOT EXISTS can_view_all_deals boolean DEFAULT false;

-- Historical daily snapshot for Commercial section
CREATE TABLE IF NOT EXISTS public.sales_monitor_daily (
  id              BIGSERIAL PRIMARY KEY,
  date            DATE        NOT NULL,
  amo_user_id     BIGINT      NOT NULL,
  manager_name    TEXT        NOT NULL,
  new_leads       INT         DEFAULT 0,
  calls_made      INT         DEFAULT 0,
  messages_sent   INT         DEFAULT 0,
  cards_moved     INT         DEFAULT 0,
  active_leads    INT         DEFAULT 0,
  zone1           INT         DEFAULT 0,
  zone2           INT         DEFAULT 0,
  zone3           INT         DEFAULT 0,
  stale_zone1     INT         DEFAULT 0,
  stale_zone2     INT         DEFAULT 0,
  stale_zone3     INT         DEFAULT 0,
  invoice_stale   INT         DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (date, amo_user_id)
);

-- RLS: only authenticated users can read; only service role can write (cron)
ALTER TABLE public.sales_monitor_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth users read daily stats"
  ON public.sales_monitor_daily FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "service role write daily stats"
  ON public.sales_monitor_daily FOR ALL
  TO service_role
  USING (true);
