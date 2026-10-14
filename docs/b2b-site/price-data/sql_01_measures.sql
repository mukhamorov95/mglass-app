-- Все запросы — только SELECT, прод Supabase через MCP execute_sql, 14.10.2026.
-- Фильтр запущенных заказов (как в PRODUCTION_100M_ROUTE): archived_at is null and launched_at is not null.
-- Выручка заказа: coalesce(nullif(total_after_discount,0), total_sale_inc_vat), с НДС.

-- Q1. Охват: сколько заказов и с какой даты есть позиции items
with o as (select * from b2b_orders where archived_at is null and launched_at is not null)
select count(*) total,
 count(*) filter (where launched_at >= date '2026-04-14') last6m,
 count(*) filter (where launched_at >= date '2026-07-16') last90,
 count(*) filter (where launched_at >= date '2026-04-14' and jsonb_typeof(items)='array' and jsonb_array_length(items)>0) last6m_items,
 min(launched_at) filter (where jsonb_typeof(items)='array' and jsonb_array_length(items)>0) first_with_items
from o;
-- результат: total 3169, last6m 915, last90 483, last6m_items 563, first_with_items 2026-07-01

-- Q2. Сверка: сумма строк (effectiveItemTotal) = выручке заказа
with o as (select id, coalesce(discount_percent,0) disc, items, coalesce(nullif(total_after_discount,0), total_sale_inc_vat) rev
  from b2b_orders where archived_at is null and launched_at >= date '2026-07-01' and jsonb_typeof(items)='array' and jsonb_array_length(items)>0),
l as (select o.id oid, o.rev, case when e->>'manualTotal' is not null then (e->>'manualTotal')::numeric
       when (e->>'clientPriced')::boolean then (e->>'saleIncVat')::numeric
       else round((e->>'saleIncVat')::numeric*(1-o.disc/100)) end eff from o, jsonb_array_elements(o.items) e),
per as (select oid, max(rev) rev, sum(eff) s from l group by oid)
select count(*) orders, round(sum(rev)) rev, round(sum(s)) sum_lines, count(*) filter (where abs(rev-s)>2) mismatched from per;
-- результат: 563 заказа, 13 630 120 против 13 630 150, расходится 1 заказ (134 ₽)

-- Q3. Распределение суммы заказа (окна 6 мес / с 01.07 / 90 дней)
with o as (select o.id, o.client_id, o.launched_at, coalesce(nullif(o.total_after_discount,0), o.total_sale_inc_vat) rev
  from b2b_orders o where o.archived_at is null and o.launched_at >= date '2026-04-14'),
w as (select '6m_0414' win, * from o union all select 'items_0701', * from o where launched_at>=date '2026-07-01'
      union all select 'last90_0716', * from o where launched_at>=date '2026-07-16')
select win, count(*) all_orders, count(*) filter (where coalesce(rev,0)=0) zero, count(*) filter (where rev>0) n, round(sum(rev)) rev,
 count(*) filter (where rev>0 and rev<3000) b1, count(*) filter (where rev>=3000 and rev<10000) b2,
 count(*) filter (where rev>=10000 and rev<30000) b3, count(*) filter (where rev>=30000) b4,
 round(sum(rev) filter (where rev>0 and rev<3000)) r1, round(sum(rev) filter (where rev>=3000 and rev<10000)) r2,
 round(sum(rev) filter (where rev>=10000 and rev<30000)) r3, round(sum(rev) filter (where rev>=30000)) r4,
 percentile_cont(0.5) within group (order by rev) filter (where rev>0) med, count(distinct client_id) clients
from w group by win order by win;   -- → dist_orders.csv

-- Q4. Строк в заказе, штук в заказе
with o as (select id, items, coalesce(nullif(total_after_discount,0), total_sale_inc_vat) rev, launched_at from b2b_orders
  where archived_at is null and launched_at >= date '2026-07-01' and jsonb_typeof(items)='array' and jsonb_array_length(items)>0),
w as (select 'A_0701' win, * from o union all select 'B_0716', * from o where launched_at >= date '2026-07-16'),
pl as (select win, id, rev, jsonb_array_length(items) nl, (select sum((e->>'quantity')::numeric) from jsonb_array_elements(items) e) pcs from w)
select win, count(*) orders, round(avg(nl),2) avg_lines, percentile_cont(0.5) within group (order by nl) med_lines,
 count(*) filter (where nl=1) l1, count(*) filter (where nl between 2 and 3) l2_3, count(*) filter (where nl between 4 and 9) l4_9,
 count(*) filter (where nl>=10) l10p, round(avg(pcs),1) avg_pcs, percentile_cont(0.5) within group (order by pcs) med_pcs
from pl group by win;
-- результат A: 563; 3,09; 2; 173/224/151/15; 5,0; 3.  B: 483; 3,03; 2; 151/197/124/11; 5,2; 3

-- Q5. Строки: штук в строке, площадь детали, сумма строки → dist_lines.csv
with o as (select id, launched_at, coalesce(discount_percent,0) disc, items from b2b_orders
  where archived_at is null and launched_at >= date '2026-07-01' and jsonb_typeof(items)='array' and jsonb_array_length(items)>0),
l as (select o.id oid, o.launched_at, e, (e->>'quantity')::numeric q, (e->>'areaPiece')::numeric ap,
  case when e->>'manualTotal' is not null then (e->>'manualTotal')::numeric
       when (e->>'clientPriced')::boolean then (e->>'saleIncVat')::numeric
       else round((e->>'saleIncVat')::numeric*(1-o.disc/100)) end eff from o, jsonb_array_elements(o.items) e),
w as (select 'A_0701' win, * from l union all select 'B_0716', * from l where launched_at>=date '2026-07-16')
select win, count(*) lines, round(sum(eff)) rev, sum(q) pcs,
 count(*) filter (where q=1) q1, count(*) filter (where q between 2 and 4) q2_4, count(*) filter (where q between 5 and 9) q5_9,
 count(*) filter (where q between 10 and 49) q10_49, count(*) filter (where q>=50) q50p,
 round(sum(eff) filter (where q=1)) r_q1, round(sum(eff) filter (where q between 2 and 4)) r_q2_4,
 round(sum(eff) filter (where q between 5 and 9)) r_q5_9, round(sum(eff) filter (where q between 10 and 49)) r_q10_49,
 round(coalesce(sum(eff) filter (where q>=50),0)) r_q50p,
 count(*) filter (where ap<0.1) a_lt01, count(*) filter (where ap>=0.1 and ap<0.25) a01_025, count(*) filter (where ap>=0.25 and ap<0.5) a025_05,
 count(*) filter (where ap>=0.5 and ap<1) a05_1, count(*) filter (where ap>=1 and ap<2) a1_2, count(*) filter (where ap>=2) a2p,
 percentile_cont(0.5) within group (order by ap) med_ap,
 count(*) filter (where eff<1500) v_lt1500, count(*) filter (where eff>=1500 and eff<3000) v1500_3k, count(*) filter (where eff>=3000 and eff<10000) v3_10k,
 count(*) filter (where eff>=10000 and eff<30000) v10_30k, count(*) filter (where eff>=30000) v30kp,
 percentile_cont(0.5) within group (order by eff) med_eff
from w group by win order by win;

-- Q6. Минимальная цена позиции: где сработала и сколько добавила → minprice.csv
with o as (select id, client_id, coalesce(discount_percent,0) disc, items from b2b_orders
  where archived_at is null and launched_at >= date '2026-07-01' and jsonb_typeof(items)='array' and jsonb_array_length(items)>0),
l as (select o.id oid, o.client_id, o.disc, e, (e->>'quantity')::numeric q, coalesce((e->>'minPriceDelta')::numeric,0) d,
   (e->>'minPriceApplied')::boolean mpa, e->>'manualTotal' is not null man, coalesce(e->>'applyMinPrice','true')='false' off
   from o, jsonb_array_elements(o.items) e)
select case when q=1 then '1' when q<5 then '2-4' when q<10 then '5-9' else '10+' end qb,
 count(*) filter (where mpa) floor_lines, round(sum(d) filter (where mpa)) delta_before_disc,
 round(sum(d*(1-disc/100)) filter (where mpa and not man)) delta_billed,
 count(*) filter (where mpa and man) floor_overridden_manual, count(*) filter (where off) floor_switched_off
from l group by 1 order by 1;
-- заказов с полом: count(distinct oid) filter (where mpa) = 117 (с 01.07), 97 (90 дней)

-- Q7. Категории: строки, пол, отверстия, вырезы
with o as (select id, coalesce(discount_percent,0) disc, items from b2b_orders where archived_at is null and launched_at >= date '2026-07-01' and jsonb_typeof(items)='array' and jsonb_array_length(items)>0),
l as (select e, (e->>'quantity')::numeric q, (e->>'minPriceApplied')::boolean mpa, coalesce((e->>'minPriceDelta')::numeric,0) mpd,
  case when e->>'manualTotal' is not null then (e->>'manualTotal')::numeric else round((e->>'saleIncVat')::numeric*(1-o.disc/100)) end eff
  from o, jsonb_array_elements(o.items) e)
select e->>'category' cat, (e->>'hasTempering')::boolean temp, count(*) lines, sum(q) pcs, round(sum(eff)) rev,
 count(*) filter (where mpa) mpa, count(*) filter (where (e->>'hasHoles')::boolean) holes, count(*) filter (where (e->>'hasCutouts')::boolean) cutouts
from l group by 1,2 order by rev desc;

-- Q8. Повторы одинаковых деталей между заказами (деталь = материал + min/max стороны + закалка; без «изделий»)
with o as (select id, client_id, coalesce(discount_percent,0) disc, items from b2b_orders where archived_at is null and launched_at >= date '2026-07-01' and jsonb_typeof(items)='array' and jsonb_array_length(items)>0),
l as (select o.id oid, o.client_id, (e->>'materialId') mid, least((e->>'width')::numeric,(e->>'height')::numeric) a,
  greatest((e->>'width')::numeric,(e->>'height')::numeric) b, coalesce(e->>'hasTempering','false') t, (e->>'quantity')::numeric q,
  case when e->>'manualTotal' is not null then (e->>'manualTotal')::numeric else round((e->>'saleIncVat')::numeric*(1-o.disc/100)) end eff
  from o, jsonb_array_elements(o.items) e where e->>'category'<>'изделие'),
p as (select mid,a,b,t, count(*) lines, count(distinct oid) orders, sum(q) pcs, sum(eff) rev from l group by 1,2,3,4)
select count(*) distinct_parts, count(*) filter (where orders>=2) parts_2plus, count(*) filter (where orders>=3) parts_3plus,
 sum(lines) all_lines, sum(lines) filter (where orders>=2) lines_rep, round(sum(rev) filter (where orders>=2)) rev_rep, round(sum(rev)) rev_all,
 sum(pcs) filter (where orders>=2) pcs_rep, sum(pcs) all_pcs, count(*) filter (where lines > orders) dup_within_order
from p;
-- результат: 1566; 31; 5; 1675; 78; 835 586; 12 355 679; 891; 2758; 53

-- Q9. Состав заказа по материалам
with o as (select id, items from b2b_orders where archived_at is null and launched_at >= date '2026-07-01' and jsonb_typeof(items)='array' and jsonb_array_length(items)>0),
l as (select o.id oid, e->>'materialId' mid from o, jsonb_array_elements(o.items) e),
po as (select oid, count(*) nl, count(distinct mid) nm from l group by oid)
select count(*) orders, round(avg(nm),2) avg_materials, count(*) filter (where nm=1) one_material,
 count(*) filter (where nl>=2) multi_line, count(*) filter (where nl>=2 and nm=1) multi_line_one_material from po;
-- результат: 563; 1,20; 468; 390; 295

-- Q10. Сегменты (своя розница / Воронеж / прочие внешние)
with o as (select o.id, coalesce(o.discount_percent,0)::numeric disc, o.items, coalesce(nullif(o.total_after_discount,0), o.total_sale_inc_vat) rev,
  case when o.client_id=1 then 'M GLASS' when c.crm_city='Воронеж' or c.name ilike '%воронеж%' then 'Воронеж' else 'Москва и пр.' end seg
  from b2b_orders o left join b2b_clients c on c.id=o.client_id
  where o.archived_at is null and o.launched_at >= date '2026-07-01' and jsonb_typeof(o.items)='array' and jsonb_array_length(o.items)>0),
l as (select o.seg, o.id oid, o.disc, e, (e->>'quantity')::numeric q from o, jsonb_array_elements(o.items) e)
select seg, count(distinct oid) orders, count(*) lines, round(100.0*count(*) filter (where q=1)/count(*),1) pct_q1,
 percentile_cont(0.5) within group (order by (e->>'areaPiece')::numeric) med_area,
 count(*) filter (where (e->>'minPriceApplied')::boolean) floor_lines,
 round(sum((e->>'minPriceDelta')::numeric*(1-disc/100)) filter (where (e->>'minPriceApplied')::boolean and e->>'manualTotal' is null)) floor_billed,
 (select percentile_cont(0.5) within group (order by rev) from o o2 where o2.seg=l.seg) med_order
from l group by seg order by seg;

-- Q11. Мелкие заказы и «соседи» того же клиента в тот же день / неделю (6 мес)
with o as (select o.id, o.client_id, o.launched_at, coalesce(nullif(o.total_after_discount,0), o.total_sale_inc_vat) rev,
    case when o.client_id=1 then 'M GLASS' when c.crm_city='Воронеж' or c.name ilike '%воронеж%' then 'Воронеж' else 'Москва и пр.' end seg
  from b2b_orders o left join b2b_clients c on c.id=o.client_id
  where o.archived_at is null and o.launched_at >= date '2026-04-14' and coalesce(nullif(o.total_after_discount,0), o.total_sale_inc_vat) > 0),
d as (select o.*, sum(rev) over (partition by client_id, launched_at) day_rev, count(*) over (partition by client_id, launched_at) day_n,
  sum(rev) over (partition by client_id, date_trunc('week', launched_at)) week_rev from o)
select seg, count(*) filter (where rev<5000) small_orders, count(*) filter (where rev<5000 and day_rev>=5000) small_but_day_ge5k,
  count(*) filter (where rev<5000 and week_rev>=5000) small_but_week_ge5k
from d group by rollup(seg) order by seg;
-- результат (итог): 93; 49; 73

-- Q12. Пол «за штуку» → «один раз на строку»: сколько рублей это стоит (по текущим ставкам)
-- (базовый CTE l — из sql_00_base_lines.sql)
-- select count(*) filter (where q>1 and v < fp*q) lines_affected,
--  round(sum((greatest(v, fp*q) - greatest(v, fp))*(1-disc/100))) loss_floor_per_line,
--  round(sum((greatest(v, fp*q) - greatest(v, fp))*(1-disc/100)) filter (where oid<>5597)) loss_wo_05597,
--  round(sum(greatest(0, fp*q - v)*(1-disc/100))) floor_now
-- from l where not fixed and floor_on and fp is not null;
-- результат: 34; 156 743; 87 598; 276 973

-- Q13. Закалка, транспорт и упаковка в модели себестоимости по месяцам запуска
with o as (select id, launched_at, items from b2b_orders where archived_at is null and launched_at >= date '2026-07-01' and launched_at < date '2026-10-01' and jsonb_typeof(items)='array'),
l as (select date_trunc('month', launched_at)::date mon, o.id oid, e from o, jsonb_array_elements(o.items) e)
select mon, round(sum((e->>'totalAreaNet')::numeric) filter (where (e->>'hasTempering')::boolean),1) temp_m2,
 sum((e->>'quantity')::numeric) filter (where (e->>'hasTempering')::boolean) temp_pcs,
 count(distinct oid) filter (where (e->>'hasTempering')::boolean) temp_orders,
 round(sum((e->>'costTempering')::numeric)) model_temp_cost, round(sum((e->>'costTransport')::numeric)) model_transport
from l group by 1 order by 1;

-- Q14. Доп. услуги в строках (тип fixed умножается на штуки)
with o as (select id, items from b2b_orders where archived_at is null and launched_at >= date '2026-07-01' and jsonb_typeof(items)='array'),
s as (select o.id oid, (e->>'quantity')::numeric q, sv from o, jsonb_array_elements(o.items) e, jsonb_array_elements(coalesce(e->'services','[]')) sv)
select sv->>'name' name, sv->>'type' type, count(*) lines, count(*) filter (where q>1) lines_q_gt1, round(sum((sv->>'cost')::numeric)) sale_rub
from s group by 1,2 order by lines desc;

-- Q15. Справочники: b2b_rates, b2b_surcharge_rules, b2b_client_prices (0 строк), b2b_clients.discount_percent
select key, value from b2b_rates order by sort;
select axis, min_mm, max_mm, surcharge_percent, shape_filter from b2b_surcharge_rules where active order by axis, min_mm;
select count(*) from b2b_client_prices;
