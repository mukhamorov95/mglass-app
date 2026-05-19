-- ── Производственные настройки: стоимость рабочего часа и накладные ──────────
-- Используется для автоматического расчёта себестоимости доп. услуг в B2B калькуляторе.
-- Singleton-таблица (одна строка, id = 1).

CREATE TABLE IF NOT EXISTS production_settings (
  id                      BIGINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  worker_monthly_salary   NUMERIC(12,2) NOT NULL DEFAULT 60000,    -- средняя з/п мастера (₽/мес)
  working_days_per_month  INT           NOT NULL DEFAULT 21,         -- рабочих дней в месяце
  working_hours_per_day   INT           NOT NULL DEFAULT 8,          -- часов в рабочем дне
  overhead_percent        NUMERIC(5,2)  NOT NULL DEFAULT 20,         -- накладные расходы (%)
  default_margin_percent  NUMERIC(5,2)  NOT NULL DEFAULT 40,         -- целевая наценка (%)
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Seed дефолтных значений
INSERT INTO production_settings (id, worker_monthly_salary, working_days_per_month, working_hours_per_day, overhead_percent, default_margin_percent)
VALUES (1, 60000, 21, 8, 20, 40)
ON CONFLICT (id) DO NOTHING;

-- RLS: авторизованные читают, только admin пишет
ALTER TABLE production_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auth read production_settings"
  ON production_settings FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Auth manage production_settings"
  ON production_settings FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
