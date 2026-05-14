-- Настройки агентов (вкл/выкл, расписание)
CREATE TABLE IF NOT EXISTS agent_settings (
  id         SERIAL PRIMARY KEY,
  agent_key  TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  description TEXT,
  enabled    BOOLEAN NOT NULL DEFAULT false,
  schedule   TEXT,          -- cron expression для справки
  last_run_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Лог запусков агентов
CREATE TABLE IF NOT EXISTS agent_logs (
  id        SERIAL PRIMARY KEY,
  agent_key TEXT NOT NULL,
  summary   JSONB,
  error     TEXT,
  ran_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed: два агента, по умолчанию выключены
INSERT INTO agent_settings (agent_key, name, description, enabled, schedule) VALUES
('revenue',  'Догонялка', 'Пишет в WhatsApp клиентам у которых расчёт без ответа 18–30ч', false, '0 * * * *'),
('analyst',  'Аналитик',  'Отчёт о метриках каждые 6 часов в Telegram админу',             false, '0 */6 * * *')
ON CONFLICT (agent_key) DO NOTHING;

-- RLS
ALTER TABLE agent_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_logs     ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth read agent_settings"  ON agent_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth manage agent_settings" ON agent_settings FOR ALL    TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Auth read agent_logs"       ON agent_logs     FOR SELECT TO authenticated USING (true);
CREATE POLICY "Auth insert agent_logs"     ON agent_logs     FOR INSERT TO authenticated WITH CHECK (true);
