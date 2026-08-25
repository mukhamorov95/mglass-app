-- Карточка позиции с сайта поставщика: ссылка, фото и технические характеристики.
-- Нужны, чтобы владелец видел, ЧТО он ставит в комплект, а визуализатор мог брать
-- реальные габариты фурнитуры вместо плейсхолдеров.
ALTER TABLE public.supplier_price_rows
  ADD COLUMN IF NOT EXISTS image_url   text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS specs       jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS enriched_at timestamptz;
