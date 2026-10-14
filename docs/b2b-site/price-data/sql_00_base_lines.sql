-- Базовый набор строк (позиции) для всех замеров и симуляций. Только чтение.
-- Окно: заказы B2B, запущенные с 01.07.2026 (позиции items пишутся только с этой даты),
-- фильтр как в PRODUCTION_100M_ROUTE: archived_at is null and launched_at is not null.
-- eff = фактическая сумма строки клиенту: manualTotal, иначе round(saleIncVat*(1-скидка)) (= effectiveItemTotal).
-- v   = цена строки по прайсу ДО минимальной цены и ДО скидки (originalLinePrice, если пол сработал).
-- fixed = договорная цена (manualTotal) или «изделие» (бандл) — в моделях не пересчитываются.
-- fp  = минимальная цена за штуку по предикату resolveMinLinePrice (lib/b2bCalculator.ts) и ставкам b2b_rates.
with o as (
  select o.id oid, o.client_id, o.launched_at, coalesce(o.discount_percent,0)::numeric disc, o.items,
         coalesce(nullif(o.total_after_discount,0), o.total_sale_inc_vat) order_rev,
         case when o.client_id=1 then 'M GLASS (своя розница)'
              when c.crm_city='Воронеж' or c.name ilike '%воронеж%' then 'Воронеж'
              else 'Москва и прочие внешние' end seg
  from b2b_orders o left join b2b_clients c on c.id=o.client_id
  where o.archived_at is null and o.launched_at >= date '2026-07-01'
    and jsonb_typeof(o.items)='array' and jsonb_array_length(o.items)>0),
l0 as (
  select o.*, e, (e->>'quantity')::numeric q, e->>'category' cat, e->>'materialId' mid,
    (e->>'width')::numeric w, (e->>'height')::numeric h,
    coalesce((e->>'hasTempering')::boolean,false) temp,
    (e->>'saleIncVat')::numeric sale,
    case when (e->>'minPriceApplied')::boolean then (e->>'originalLinePrice')::numeric else (e->>'saleIncVat')::numeric end v,
    (e->>'manualTotal' is not null or e->>'category'='изделие') fixed,
    coalesce(e->>'applyMinPrice','true') <> 'false' floor_on,
    case when e->>'manualTotal' is not null then (e->>'manualTotal')::numeric
         else round((e->>'saleIncVat')::numeric*(1-o.disc/100)) end eff
  from o, jsonb_array_elements(o.items) e),
l as (
  select l0.*,
    case when least(w,h) < 250 then 1500
         when temp and cat in ('тонированное','сатин','рифленое','декоративное') then 3000
         when temp then 2500
         when cat='зеркало' then 1500 end fp
  from l0)
