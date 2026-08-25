-- История цен поставщика: снимок пишется, когда цена позиции отличается от предыдущего
-- снимка. Импорт идёт через delete+insert (reset), поэтому ловим и вставку тоже —
-- иначе история терялась бы при каждой полной перезагрузке прайса.
CREATE TABLE IF NOT EXISTS public.supplier_price_history (
  id           bigserial PRIMARY KEY,
  supplier     text NOT NULL,
  article      text NOT NULL DEFAULT '',
  color        text NOT NULL DEFAULT '',
  name         text NOT NULL DEFAULT '',
  retail_price numeric NOT NULL DEFAULT 0,
  cost_price   numeric NOT NULL DEFAULT 0,
  captured_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sph_key_idx ON public.supplier_price_history (supplier, article, color, captured_at DESC);
ALTER TABLE public.supplier_price_history ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.supplier_price_snapshot() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE last_cost numeric;
BEGIN
  SELECT h.cost_price INTO last_cost
  FROM public.supplier_price_history h
  WHERE h.supplier = NEW.supplier AND h.article = NEW.article AND h.color = NEW.color
  ORDER BY h.captured_at DESC LIMIT 1;

  IF last_cost IS NULL OR last_cost IS DISTINCT FROM NEW.cost_price THEN
    INSERT INTO public.supplier_price_history (supplier, article, color, name, retail_price, cost_price)
    VALUES (NEW.supplier, NEW.article, NEW.color, NEW.name, NEW.retail_price, NEW.cost_price);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS supplier_price_rows_history ON public.supplier_price_rows;
CREATE TRIGGER supplier_price_rows_history
AFTER INSERT OR UPDATE OF cost_price, retail_price ON public.supplier_price_rows
FOR EACH ROW EXECUTE FUNCTION public.supplier_price_snapshot();
