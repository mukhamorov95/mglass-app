-- Max discount limit per product type
ALTER TABLE financial_settings
  ADD COLUMN IF NOT EXISTS max_discount_percent numeric(5,2) NOT NULL DEFAULT 15;
