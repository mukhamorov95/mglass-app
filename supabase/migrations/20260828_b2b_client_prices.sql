-- А12: индивидуальный прайс B2B-клиента.
--
-- Зачем: до этого договорённость с клиентом описывалась одной цифрой
-- b2b_clients.discount_percent — «минус N% на всё». Реальные договорённости так не
-- выглядят: у одного клиента своя цена на осветлённое, у другого — на зеркало,
-- а на остальное общий прайс. Теперь цена материала для клиента — отдельная запись.
--
-- Приоритет цены (сверху вниз, реализован в lib/b2b/clientPrices.ts):
--   1. Ручная цена позиции (manualTotal) — договорная сумма строки
--   2. Прайс клиента (эта таблица)
--   3. Общий прайс (glass_price_matrix → b2b_materials.notes.sale_price)
-- Скидка клиента к индивидуальной цене НЕ применяется: индивидуальная цена и есть
-- итоговая договорённость, иначе скидка задваивается.

CREATE TABLE IF NOT EXISTS public.b2b_client_prices (
  id            bigserial PRIMARY KEY,
  client_id     bigint NOT NULL REFERENCES public.b2b_clients(id) ON DELETE CASCADE,
  material_id   bigint NOT NULL REFERENCES public.b2b_materials(id) ON DELETE CASCADE,
  sale_price    numeric(12,2) NOT NULL CHECK (sale_price > 0),  -- ₽/м², вкл. НДС (как общий прайс)
  comment       text NOT NULL DEFAULT '',
  active        boolean NOT NULL DEFAULT true,
  created_by    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_by_name text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Одна действующая цена на пару «клиент + материал».
CREATE UNIQUE INDEX IF NOT EXISTS b2b_client_prices_uniq
  ON public.b2b_client_prices (client_id, material_id);
CREATE INDEX IF NOT EXISTS b2b_client_prices_client_idx
  ON public.b2b_client_prices (client_id) WHERE active;

ALTER TABLE public.b2b_client_prices ENABLE ROW LEVEL SECURITY;

-- Читают: владелец, коммерческий, финансы и менеджер (цены нужны в калькуляторе).
-- Партнёр к таблице не ходит — его расчёт считает сервер сервис-клиентом.
DROP POLICY IF EXISTS b2b_client_prices_select ON public.b2b_client_prices;
CREATE POLICY b2b_client_prices_select ON public.b2b_client_prices
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role IN ('admin','ceo','cfo','commercial','manager','buyer')
  ));

-- Пишут: владелец и коммерческий. Цена — деньги, менеджер её не редактирует.
DROP POLICY IF EXISTS b2b_client_prices_write ON public.b2b_client_prices;
CREATE POLICY b2b_client_prices_write ON public.b2b_client_prices
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role IN ('admin','ceo','commercial')
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role IN ('admin','ceo','commercial')
  ));
