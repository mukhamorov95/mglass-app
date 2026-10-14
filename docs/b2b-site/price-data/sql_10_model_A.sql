-- Модель A: «наладка» S на строку (A-line) или на группу «заказ × материал» (A-group).
-- Строка по прайсу без пола: k·v; пол (минимальная цена позиции) снят — его роль берёт S.
-- k подбирается так, чтобы сумма по пересчитываемым строкам = текущей (нейтрально по выручке).
-- Скидка клиента применяется после, как сейчас. Договорные строки и «изделия» не меняются.
, rep as (select * from l where not fixed),
grp as (select oid, mid, max(disc) disc from rep group by oid, mid),
tot as (select sum(eff) e, sum(v*(1-disc/100)) vd, sum(1-disc/100) nd from rep),
gtot as (select sum(1-disc/100) gnd from grp),
par as (select m, s,
   case when m='A-line' then (t.e - s*t.nd)/t.vd else (t.e - s*g.gnd)/t.vd end k
   from (values ('A-line'),('A-group')) mm(m) cross join (values (500),(1000),(1500),(2000)) ss(s) cross join tot t cross join gtot g),
nl as (
  select p.m, p.s, p.k, l.oid, l.seg, l.order_rev, l.mid, l.disc, l.fixed,
     case when l.fixed then l.eff else round(p.k*l.v*(1-l.disc/100)) + case when p.m='A-line' then round(p.s*(1-l.disc/100)) else 0 end end new_line, l.eff
  from l cross join par p),
gadd as (select p.m, p.s, g.oid, sum(round(p.s*(1-g.disc/100))) add from grp g cross join par p where p.m='A-group' group by p.m,p.s,g.oid),
no0 as (select n.m, n.s, n.k, n.oid, max(n.seg) seg, max(n.order_rev) cur, sum(n.new_line) new0 from nl n group by n.m, n.s, n.k, n.oid),
no as (select no0.*, new0 + coalesce(a.add,0) new from no0 left join gadd a on a.m=no0.m and a.s=no0.s and a.oid=no0.oid)
select m, s, round(k,4) k, grp_key,
  count(*) orders, round(sum(cur)) cur_rev, round(sum(new)) new_rev, round(sum(new-cur)) delta,
  count(*) filter (where new > cur*1.05) up5, count(*) filter (where new > cur*1.20) up20, count(*) filter (where new < cur*0.95) down5,
  round((percentile_cont(0.5) within group (order by (new-cur)/nullif(cur,0)))::numeric*100,1) med_change_pct
from (
  select *, 'Все' grp_key from no
  union all select *, 'Сегмент: '||seg from no
  union all select *, 'Заказ: '||case when cur<3000 then '1 <3 тыс' when cur<10000 then '2 3–10 тыс' when cur<30000 then '3 10–30 тыс' else '4 ≥30 тыс' end from no
) z group by m, s, k, grp_key order by m, s, grp_key;
