CREATE TABLE IF NOT EXISTS purchase_order_payments (
  id                serial PRIMARY KEY,
  purchase_order_id integer NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  amount            numeric NOT NULL,
  payment_date      date,
  comment           text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'purchase_order_payments_amount_positive'
  ) THEN
    ALTER TABLE purchase_order_payments
    ADD CONSTRAINT purchase_order_payments_amount_positive
    CHECK (amount > 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_purchase_order_payments_purchase_order_id
ON purchase_order_payments(purchase_order_id);

-- Backfill: one payment per existing purchase_order where legacy payment_amount exists.
-- Safe for production databases where payment_amount/payment_date columns do not exist.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'purchase_orders'
      AND column_name = 'payment_amount'
  ) THEN
    INSERT INTO purchase_order_payments (
      purchase_order_id,
      amount,
      payment_date,
      comment
    )
    SELECT
      po.id,
      po.payment_amount,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = 'purchase_orders'
            AND column_name = 'payment_date'
        ) THEN po.payment_date
        ELSE NULL
      END,
      'Backfill from purchase_orders.payment_amount'
    FROM purchase_orders po
    WHERE po.payment_amount IS NOT NULL
      AND po.payment_amount > 0
      AND NOT EXISTS (
        SELECT 1
        FROM purchase_order_payments p
        WHERE p.purchase_order_id = po.id
      );
  END IF;
END $$;
