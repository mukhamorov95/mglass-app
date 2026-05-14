-- Себестоимость услуги (закупочная цена)
ALTER TABLE b2b_services ADD COLUMN IF NOT EXISTS cost_price numeric NOT NULL DEFAULT 0;

-- Устанавливаем себестоимость триплекса = 2500 ₽/м²
UPDATE b2b_services SET cost_price = 2500 WHERE LOWER(name) LIKE '%трипл%';
