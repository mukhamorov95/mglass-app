-- Payment tracking on orders
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_status   text    NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS prepayment_amount numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prepayment_date  date,
  ADD COLUMN IF NOT EXISTS payment_notes    text;

-- Constraint: unpaid | partial | paid
ALTER TABLE orders
  DROP CONSTRAINT IF EXISTS orders_payment_status_check;
ALTER TABLE orders
  ADD CONSTRAINT orders_payment_status_check
  CHECK (payment_status IN ('unpaid', 'partial', 'paid'));
