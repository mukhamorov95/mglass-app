-- Рекомендации AI Control Center опираются на цифры учёта (этап 3, 06.10.2026).
--
-- evidence — цифры, на которых держится рекомендация: значение, период и источник
-- считает код, модель только называет id. Плюс какую цифру сверить после «сделано»
-- и числа из текста модели, которых в данных нет.
-- recheck — сверка той же цифры через месяц после «сделано»: было → стало.

alter table public.ai_recommendations
  add column if not exists evidence   jsonb,
  add column if not exists recheck    jsonb,
  add column if not exists recheck_at timestamptz;
