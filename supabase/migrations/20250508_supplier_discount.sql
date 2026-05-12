-- Скидка на уровне поставщика (применяется ко всем его позициям)
ALTER TABLE public.shower_hw_suppliers
  ADD COLUMN IF NOT EXISTS discount_pct numeric NOT NULL DEFAULT 0;

-- При обновлении скидки поставщика — пересчитать cost_price для всех его позиций
CREATE OR REPLACE FUNCTION public.recalc_supplier_prices()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.discount_pct IS DISTINCT FROM OLD.discount_pct THEN
    UPDATE public.shower_catalog_prices
    SET
      discount_percent = NEW.discount_pct,
      cost_price       = ROUND(website_price * (1 - NEW.discount_pct / 100))
    WHERE supplier_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_supplier_discount ON public.shower_hw_suppliers;
CREATE TRIGGER trg_supplier_discount
  AFTER UPDATE OF discount_pct ON public.shower_hw_suppliers
  FOR EACH ROW EXECUTE FUNCTION public.recalc_supplier_prices();
