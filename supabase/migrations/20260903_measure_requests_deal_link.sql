-- Шаг 2 пути сделки: замер связывается со сделкой и получает файлы результата.
-- deal_id (nullable, ON DELETE SET NULL) — как calculations/документы. photos для
-- файлов замера (чертёж/фото), text[] как в legacy measurements.photos.
-- RLS у measure_requests — единая политика USING(true) для authenticated; добавление
-- колонок её не меняет, новых политик не требуется.

alter table public.measure_requests
  add column if not exists deal_id bigint references public.deals(id) on delete set null;
create index if not exists idx_measure_requests_deal on public.measure_requests(deal_id) where deal_id is not null;

alter table public.measure_requests
  add column if not exists photos text[] not null default '{}';
