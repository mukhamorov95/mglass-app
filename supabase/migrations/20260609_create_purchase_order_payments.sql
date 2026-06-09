-- payment history per purchase order
CREATE TABLE IF NOT EXISTS purchase_order_payments (
  id                  serial PRIMARY KEY,
  purchase_order_id   integer NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  amount              numeric NOT NULL CHECK (amount > 0),
  payment_date        date,
  comment             text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid
);

CREATE INDEX IF NOT EXISTS idx_purchase_order_payments_purchase_order_id
  ON purchase_order_payments (purchase_order_id);

-- Backfill: one payment per existing purchase_order where payment_amount > 0
INSERT INTO purchase_order_payments (
  purchase_order_id,
  amount,
  payment_date,
  comment
)
SELECT
  id,
  payment_amount,
  payment_date,
  'Backfill from purchase_orders.payment_amount'
FROM purchase_orders po
WHERE payment_amount IS NOT NULL
  AND payment_amount > 0
  AND NOT EXISTS (
    SELECT 1
    FROM purchase_order_payments p
    WHERE p.purchase_order_id = po.id
  );
