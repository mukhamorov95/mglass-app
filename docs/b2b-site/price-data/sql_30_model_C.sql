-- Модель C: текущий прайс без изменений + минимальная сумма заказа M (доплата до M).
-- Уровень заказа, окно 6 месяцев (запуск с 14.04.2026) и окно с позициями (с 01.07.2026).
-- Заказы с нулевой суммой (rev = 0) исключены и посчитаны отдельно.
with o as (
  select o.id, o.client_id, o.launched_at, coalesce(nullif(o.total_after_discount,0), o.total_sale_inc_vat) rev,
    case when o.client_id=1 then 'M GLASS (своя розница)'
         when c.crm_city='Воронеж' or c.name ilike '%воронеж%' then 'Воронеж'
         else 'Москва и прочие внешние' end seg
  from b2b_orders o left join b2b_clients c on c.id=o.client_id
  where o.archived_at is null and o.launched_at >= date '2026-04-14'),
w as (select '6 мес (с 14.04)' win, * from o union all select 'с позициями (с 01.07)', * from o where launched_at>=date '2026-07-01'),
mm as (select unnest(array[3000,5000,7500,10000]) m)
select win, m, grp, count(*) filter (where rev>0) orders, count(*) filter (where rev>0 and rev<m) hit, count(distinct client_id) filter (where rev>0 and rev<m) clients_hit,
  round(sum(rev) filter (where rev>0)) rev, round(coalesce(sum(m-rev) filter (where rev>0 and rev<m),0)) add_rub,
  round(100.0*coalesce(sum(m-rev) filter (where rev>0 and rev<m),0)/nullif(sum(rev) filter (where rev>0),0),2) add_pct,
  count(*) filter (where rev is null or rev=0) zero_orders
from (select *, 'Все' grp from w union all select *, seg from w) z cross join mm
group by win, m, grp order by win, m, grp;
