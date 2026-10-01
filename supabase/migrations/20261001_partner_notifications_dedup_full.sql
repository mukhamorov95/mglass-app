-- Уведомления партнёру не работали с 24.08: dedup-индекс был частичным
-- (WHERE order_id IS NOT NULL), а PostgREST строит ON CONFLICT (client_id, order_id, kind)
-- без предиката — база отвергала каждую запись, таблица осталась пустой.
-- Владелец 01.10: включить с сегодняшнего дня, без писем о прошлых событиях.
-- Поэтому в одной транзакции: текущие состояния заказов партнёров помечаем как уже
-- отправленные и прочитанные, затем меняем индекс на полный. NULL в order_id
-- по-прежнему не конфликтуют — смысл прежнего частичного индекса сохранён.

with o as (
  select b.id, b.client_id,
         coalesce(nullif(trim(b.custom_number), ''), '#' || b.id) as num,
         (b.launched_at is not null
           or coalesce(case when b.notes ~ '^\s*\{' then b.notes::jsonb end -> 'launched_at', 'null'::jsonb) not in ('null'::jsonb, 'false'::jsonb)) as launched,
         coalesce(case when b.notes ~ '^\s*\{' then b.notes::jsonb end -> 'stages', '{}'::jsonb) as st
  from public.b2b_orders b
  join public.b2b_clients c on c.id = b.client_id
  where c.user_id is not null and b.archived_at is null
),
t as (
  select id, client_id, num, 'in_work'::text as kind, 'Заказ принят в работу' as title from o where launched
  union all
  select id, client_id, num, 'ready', 'Заказ готов к выдаче' from o
   where coalesce(coalesce(st -> 'packed', st -> 'packaged'), 'null'::jsonb) not in ('null'::jsonb, 'false'::jsonb)
     and coalesce(st -> 'shipped', 'null'::jsonb) in ('null'::jsonb, 'false'::jsonb)
  union all
  select id, client_id, num, 'shipped', 'Заказ отгружен' from o
   where coalesce(st -> 'shipped', 'null'::jsonb) not in ('null'::jsonb, 'false'::jsonb)
)
insert into public.partner_notifications (client_id, order_id, kind, title, link, read_at, emailed_at)
select client_id, id, kind, title || ' · ' || num, '/partner/order/' || id, now(), now()
from t
where not exists (
  select 1 from public.partner_notifications n
  where n.client_id = t.client_id and n.order_id = t.id and n.kind = t.kind
);

create unique index if not exists partner_notifications_dedup_full_idx
  on public.partner_notifications (client_id, order_id, kind);
drop index if exists public.partner_notifications_dedup_idx;
