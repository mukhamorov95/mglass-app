-- След каскада: кто вызвал автозакрытие и своим ли этапом.
-- completed_by у каскадных задач по-прежнему NULL — выработку человеку не приписываем.
-- Эти колонки нужны для другого: показать цеху, сколько изделий прошло без живых
-- отметок и по чьей отметке они закрылись (экран /production-app/no-marks).
alter table public.production_tasks
  add column if not exists auto_closed_by      uuid,
  add column if not exists auto_closed_by_name text,
  add column if not exists auto_closed_from    text;

comment on column public.production_tasks.auto_closed_by is
  'Кто отметил свой этап, из-за чего эта задача закрылась каскадом. Не выработка этого человека.';
comment on column public.production_tasks.auto_closed_from is
  'Этап, отметка которого вызвала каскад (например packaging).';

create index if not exists production_tasks_auto_closed_idx
  on public.production_tasks (auto_closed, completed_at)
  where auto_closed is true;

-- Восстановление истории: инициатор = живая отметка того же изделия с тем же
-- completed_at и более поздним этапом. Так нашлось 440 из 455 каскадных задач.
with live as (
  select order_id, item_index, completed_at, sequence_order, stage_key, completed_by, completed_by_name
  from production_tasks
  where coalesce(auto_closed,false) = false and status='done' and completed_by_name is not null
), pick as (
  select distinct on (a.id) a.id, l.completed_by, l.completed_by_name, l.stage_key
  from production_tasks a
  join live l on l.order_id = a.order_id and l.item_index = a.item_index
             and l.completed_at = a.completed_at and l.sequence_order > a.sequence_order
  where a.auto_closed is true and a.auto_closed_by_name is null
  order by a.id, l.sequence_order asc
)
update production_tasks t
set auto_closed_by = p.completed_by,
    auto_closed_by_name = p.completed_by_name,
    auto_closed_from = p.stage_key
from pick p where p.id = t.id;
