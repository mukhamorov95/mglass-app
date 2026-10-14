-- Модель B: минимальная сумма заказа M + лесенка за тираж одинаковых деталей + пол позиции один раз на строку.
-- Одинаковая деталь = (заказ, материал, min(ш,в), max(ш,в), закалка); q детали = сумма q таких строк в заказе.
-- Лесенка L(q): 1 → 0 %, 2–4 → 5 %, 5–9 → 10 %, 10–24 → 15 %, 25–49 → 20 %, 50+ → 25 % (параметр, не решение).
-- Строка: max(fp, k·v·(1−L)) — пол fp берётся ОДИН раз на строку, а не fp × q (сейчас fp × q).
-- Заказ: max(M, Σ строк после скидки + договорные строки). k — по сетке, чтобы выручка = текущей.
, lp as (select l.*, sum(q) over (partition by oid, mid, least(w,h), greatest(w,h), temp) qpart from l),
lad as (select lp.*, case when qpart>=50 then .25 when qpart>=25 then .20 when qpart>=10 then .15 when qpart>=5 then .10 when qpart>=2 then .05 else 0 end lr from lp),
grid as (select m, k from (values (0),(3000),(5000)) mm(m) cross join generate_series(0.900, 1.060, 0.0005) k),
nl as (select g.m, g.k, d.oid, d.seg, d.order_rev,
         case when d.fixed then d.eff
              else round(greatest(case when d.floor_on and d.fp is not null then d.fp else 0 end, g.k*d.v*(1-d.lr))*(1-d.disc/100)) end new_line
       from lad d cross join grid g),
no as (select m, k, oid, max(seg) seg, max(order_rev) cur, greatest(m, sum(new_line)) new from nl group by m, k, oid),
fit as (select distinct on (m) m, k from (select m, k, abs(sum(new)-sum(cur)) gap from no group by m, k) z order by m, gap)
select f.m, f.k, grp_key, count(*) orders, round(sum(cur)) cur_rev, round(sum(new)) new_rev, round(sum(new-cur)) delta,
  count(*) filter (where new > cur*1.05) up5, count(*) filter (where new > cur*1.20) up20, count(*) filter (where new < cur*0.95) down5,
  count(*) filter (where new = f.m and f.m>0) at_min_order
from fit f join (
  select *, 'Все' grp_key from no
  union all select *, 'Сегмент: '||seg from no
  union all select *, 'Заказ: '||case when cur<3000 then '1 <3 тыс' when cur<10000 then '2 3–10 тыс' when cur<30000 then '3 10–30 тыс' else '4 ≥30 тыс' end from no
) z on z.m=f.m and z.k=f.k
group by f.m, f.k, grp_key order by f.m, grp_key;
