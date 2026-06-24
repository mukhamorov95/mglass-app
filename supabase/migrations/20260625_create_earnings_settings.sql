-- ══════════════════════════════════════════════════════════════════════════════
-- M-Glass — глобальные настройки системы мотивации (B2C-менеджеры).
--
-- Одна строка на scope ('b2c_manager' сейчас, будущие 'b2b_manager' и т.д.).
-- Хранит оклад, ступени комиссии (JSONB), бонусы серии (JSONB), дату начала
-- действия и текст регламента. Owner/admin редактирует на /my-earnings,
-- менеджеры читают и применяют.
--
-- Что миграция НЕ делает:
--   - не трогает calculations / users / pricing_model_config_v2
--   - не создаёт таблицу manager_sales (отдельный этап)
--   - не задаёт role-based RLS (пока authenticated read+write — UI ограничивает
--     edit на owner-уровне; жёсткий RLS добавится после оформления роли)
--
-- Идемпотентность:
--   - CREATE TABLE IF NOT EXISTS
--   - UNIQUE на scope позволяет upsert через ON CONFLICT
--   - CREATE INDEX IF NOT EXISTS / DROP POLICY IF EXISTS
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.earnings_settings (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  scope             text          NOT NULL DEFAULT 'b2c_manager',
  active            boolean       NOT NULL DEFAULT true,
  base_salary_rub   numeric(12,2) NOT NULL DEFAULT 60000,
  commission_tiers  jsonb         NOT NULL DEFAULT '[
    {"from":0,"to":2000000,"ratePercent":2},
    {"from":2000000,"to":3000000,"ratePercent":2.5},
    {"from":3000000,"to":4000000,"ratePercent":3},
    {"from":4000000,"to":5000000,"ratePercent":4},
    {"from":5000000,"to":null,"ratePercent":5}
  ]'::jsonb,
  streak_bonuses    jsonb         NOT NULL DEFAULT '[
    {"minRevenue":3000000,"bonus":20000},
    {"minRevenue":4000000,"bonus":40000},
    {"minRevenue":5000000,"bonus":60000}
  ]'::jsonb,
  effective_from    date          NOT NULL DEFAULT '2026-07-01',
  rules_note        text          NOT NULL DEFAULT 'Новая система действует для B2C-заказов с 1 июля. В зачёт идут только подтверждённые B2C-продажи. B2B-продажи будут подключены отдельно по другим правилам. Условия могут пересматриваться по мере роста компании, но изменения будут заранее озвучиваться.',
  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now(),
  CONSTRAINT earnings_settings_scope_unique UNIQUE (scope)
);

CREATE INDEX IF NOT EXISTS idx_earnings_settings_scope_active
  ON public.earnings_settings(scope, active);

-- ── updated_at trigger ──────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS update_earnings_settings_updated_at
  ON public.earnings_settings;
CREATE TRIGGER update_earnings_settings_updated_at
  BEFORE UPDATE ON public.earnings_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Текущая модель: любой authenticated может читать и писать. UI ограничивает
-- edit на owner-уровне (role admin/ceo). Жёсткий role-based RLS — отдельный
-- шаг после оформления единого role-helper для PostgreSQL.
ALTER TABLE public.earnings_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "earnings_settings_select_authenticated"
  ON public.earnings_settings;
CREATE POLICY "earnings_settings_select_authenticated"
  ON public.earnings_settings
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "earnings_settings_admin_write"
  ON public.earnings_settings;
CREATE POLICY "earnings_settings_admin_write"
  ON public.earnings_settings
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- ── Seed/upsert дефолтной B2C-конфигурации ──────────────────────────────────
-- Идемпотентно: ON CONFLICT гарантирует, что повторное применение приведёт
-- строку к каноническому состоянию (60 000 ₽ оклад + 5 ступеней + 3 бонуса).
INSERT INTO public.earnings_settings (
  scope, active, base_salary_rub,
  commission_tiers, streak_bonuses,
  effective_from, rules_note
)
VALUES (
  'b2c_manager', true, 60000,
  '[
    {"from":0,"to":2000000,"ratePercent":2},
    {"from":2000000,"to":3000000,"ratePercent":2.5},
    {"from":3000000,"to":4000000,"ratePercent":3},
    {"from":4000000,"to":5000000,"ratePercent":4},
    {"from":5000000,"to":null,"ratePercent":5}
  ]'::jsonb,
  '[
    {"minRevenue":3000000,"bonus":20000},
    {"minRevenue":4000000,"bonus":40000},
    {"minRevenue":5000000,"bonus":60000}
  ]'::jsonb,
  DATE '2026-07-01',
  'Новая система действует для B2C-заказов с 1 июля. В зачёт идут только подтверждённые B2C-продажи. B2B-продажи будут подключены отдельно по другим правилам. Условия могут пересматриваться по мере роста компании, но изменения будут заранее озвучиваться.'
)
ON CONFLICT (scope) DO UPDATE
SET
  active           = EXCLUDED.active,
  base_salary_rub  = EXCLUDED.base_salary_rub,
  commission_tiers = EXCLUDED.commission_tiers,
  streak_bonuses   = EXCLUDED.streak_bonuses,
  effective_from   = EXCLUDED.effective_from,
  rules_note       = EXCLUDED.rules_note,
  updated_at       = now();
