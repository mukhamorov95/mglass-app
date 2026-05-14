-- Расширяем agent_settings: память, конфиг, статистика
ALTER TABLE agent_settings
  ADD COLUMN IF NOT EXISTS memory           JSONB    NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS config           JSONB    NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS last_action_text TEXT,
  ADD COLUMN IF NOT EXISTS total_runs       INTEGER  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_running       BOOLEAN  NOT NULL DEFAULT false;

-- Расширяем agent_logs: уровень, иконка
ALTER TABLE agent_logs
  ADD COLUMN IF NOT EXISTS level  TEXT NOT NULL DEFAULT 'info',
  ADD COLUMN IF NOT EXISTS icon   TEXT NOT NULL DEFAULT 'ℹ️';

-- Добавляем двух новых сотрудников
INSERT INTO agent_settings (agent_key, name, description, enabled, schedule, config) VALUES
('production', 'Максим', 'Мониторит заказы, сроки, узкие места производства. Отчёт каждые 6ч.', false, '0 */6 * * *',
  '{"priority_metrics": ["overdue_orders", "avg_lead_time", "rework_count"], "notify": "admin"}'::jsonb),
('catalog', 'Наполнитель', 'Предлагает новые позиции в справочники. Ждёт одобрения перед добавлением.', false, '0 9 * * *',
  '{"require_approval": true, "max_suggestions_per_day": 10}'::jsonb)
ON CONFLICT (agent_key) DO NOTHING;

-- Обновляем конфиги существующих
UPDATE agent_settings SET config = '{"followup_hours": 18, "max_per_run": 10}'::jsonb WHERE agent_key = 'revenue'  AND config = '{}'::jsonb;
UPDATE agent_settings SET config = '{"notify": "admin", "interval_hours": 6}'::jsonb  WHERE agent_key = 'analyst' AND config = '{}'::jsonb;

-- Индекс для быстрой выборки логов
CREATE INDEX IF NOT EXISTS agent_logs_key_time ON agent_logs (agent_key, ran_at DESC);
