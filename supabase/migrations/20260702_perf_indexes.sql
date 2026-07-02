-- ============================================================================
-- Индексы производительности. Аддитивно, безопасно, near-instant на текущем объёме.
-- Применять в Supabase SQL Editor (авто-раннера миграций в проекте нет).
--
-- Корень задержек: почти все тяжёлые запросы делают ORDER BY created_at DESC по
-- b2b_orders (>2600 строк), но индекса на created_at не было → full-scan + сортировка
-- на каждый заход. Ускоряет: /b2b-orders, /b2b-quotes, /cfo/b2b, /manager-dashboard,
-- /b2b-analytics, /b2b-production, /production-app/supervisor.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_b2b_orders_created_at
  ON public.b2b_orders (created_at DESC);

-- Составной под менеджерский скоуп (created_by = свои заказы) + сортировка по дате.
CREATE INDEX IF NOT EXISTS idx_b2b_orders_created_by_created_at
  ON public.b2b_orders (created_by, created_at DESC);

-- Под самый частый запрос расчётов (свои + по дате): /cfo/margins, /cfo/unit, дашборды.
CREATE INDEX IF NOT EXISTS idx_calculations_created_by_created_at
  ON public.calculations (created_by, created_at DESC);
