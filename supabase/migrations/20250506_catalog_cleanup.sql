-- Убираем manufacturer с позиций фурнитуры — он хранится только в матрице цен (shower_catalog_prices.supplier_id)
alter table public.shower_catalog_items drop column if exists manufacturer;
-- color_id не существовал на таблице — только в TypeScript-типах, уже исправлено в коде
