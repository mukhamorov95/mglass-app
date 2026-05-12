-- ─── Optimistic locking для b2b_clients ──────────────────────────────────────
-- Добавляет updated_at + триггер. Нужен для race condition protection:
-- менеджеры проверяют версию перед записью.

ALTER TABLE b2b_clients
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Backfill: ставим created_at там где updated_at ещё null
UPDATE b2b_clients SET updated_at = created_at WHERE updated_at IS NULL;

-- Универсальная функция (переиспользуется другими таблицами)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_b2b_clients_updated_at ON b2b_clients;
CREATE TRIGGER set_b2b_clients_updated_at
  BEFORE UPDATE ON b2b_clients
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
