-- B2B Orders: manager tracking + production status + deadline
ALTER TABLE b2b_orders
  ADD COLUMN IF NOT EXISTS manager_name      text,
  ADD COLUMN IF NOT EXISTS production_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS deadline_date     date;
