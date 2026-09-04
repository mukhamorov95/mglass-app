-- Позиция подсветки ссылается на строку прайса поставщика: цена приходит оттуда,
-- а не вводится руками. Владелец: «в прайсе поставщика уже указано всё».
-- cost_price остаётся как зафиксированная цена в рублях на момент выбора —
-- курс меняется, пересчитываем кнопкой, а не молча при каждом расчёте.
alter table public.mirror_lighting_components add column if not exists source_supplier text;
alter table public.mirror_lighting_components add column if not exists source_item_id bigint;
alter table public.mirror_lighting_components add column if not exists price_updated_at timestamptz;

comment on column public.mirror_lighting_components.source_item_id is 'supplier_price_items.id — откуда взята цена';
comment on column public.mirror_lighting_components.price_updated_at is 'Когда цена пересчитана по курсу';

create index if not exists mirror_components_source_idx on public.mirror_lighting_components (source_supplier, source_item_id);
