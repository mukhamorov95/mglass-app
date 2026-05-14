INSERT INTO agent_settings (agent_key, name, description, enabled, schedule, config) VALUES
('ceo', 'AI CEO', 'Координирует команду, находит узкие места, пишет ежедневный брифинг владельцу.', false, '0 */6 * * *',
  '{"goal_monthly": 15000000, "report_hour": 8, "auto_delegate": true}'::jsonb)
ON CONFLICT (agent_key) DO NOTHING;
