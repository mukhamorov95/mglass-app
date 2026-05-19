-- Добавить поля стоимости работы по приклейке к b2b_films
ALTER TABLE b2b_films
  ADD COLUMN IF NOT EXISTS work_cost_per_m2  NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS work_sale_per_m2  NUMERIC(12,2) NOT NULL DEFAULT 0;
