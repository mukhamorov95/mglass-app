-- Поиск с любого экрана (маршрут docs/MANAGER_UX_ROUTE.md, У4).
-- SECURITY INVOKER: работает под RLS вызывающего, видит не больше, чем он сам.
-- Остальная изоляция (какие разделы доступны роли, «только M GLASS», свои расчёты)
-- приходит параметрами из /api/search, который берёт их из профиля на сервере.
-- Подставить из консоли более широкие флаги бессмысленно: те же строки и так
-- доступны этому человеку прямым запросом к таблице под его RLS.
-- Телефоны записаны по-разному (+7 926 418 6972, +7 (920) 216-93-80, +7926…),
-- поэтому сравниваем только цифры.

create or replace function public.app_search(
  p_q text,
  p_digits text,
  p_orders boolean,
  p_mglass_ids int[],
  p_clients boolean,
  p_deals boolean,
  p_calcs boolean,
  p_calc_owner uuid,
  p_limit int default 6
)
returns jsonb
language sql
stable
security invoker
set search_path to 'public'
as $$
  with args as (
    select coalesce(p_q, '') as q,
           coalesce(p_digits, '') as d,
           least(greatest(coalesce(p_limit, 6), 1), 10) as lim
  )
  select jsonb_build_object(
    'orders', case when p_orders then coalesce((
      select jsonb_agg(o) from (
        select b.id, b.custom_number, b.client_name, b.launched_at, b.created_at,
               coalesce(b.total_after_discount, b.total_sale_inc_vat) as total
        from b2b_orders b, args a
        where b.archived_at is null
          and (p_mglass_ids is null or b.client_id = any (p_mglass_ids))
          and (
            (a.d <> '' and (b.id::text = a.d or b.custom_number ilike a.d || '%' or b.client_order_number ilike '%' || a.d || '%'))
            or (length(a.q) >= 2 and (b.client_name ilike '%' || a.q || '%' or b.custom_number ilike a.q || '%'))
          )
        order by b.created_at desc
        limit (select lim from args)
      ) o), '[]'::jsonb) else '[]'::jsonb end,

    'clients', case when p_clients then coalesce((
      select jsonb_agg(c) from (
        select k.id, k.name, k.inn, k.phone
        from b2b_clients k, args a
        where (length(a.q) >= 2 and (k.name ilike '%' || a.q || '%' or k.full_name ilike '%' || a.q || '%'))
           or (length(a.d) >= 4 and (k.inn like a.d || '%' or regexp_replace(coalesce(k.phone, ''), '\D', '', 'g') like '%' || a.d || '%'))
        order by k.name
        limit (select lim from args)
      ) c), '[]'::jsonb) else '[]'::jsonb end,

    'deals', case when p_deals then coalesce((
      select jsonb_agg(x) from (
        select s.id, s.client_name, s.phone, s.amo_lead_id, s.created_at
        from deals s, args a
        where s.archived_at is null
          and (
            (length(a.q) >= 2 and s.client_name ilike '%' || a.q || '%')
            or (length(a.d) >= 4 and s.phone_key like '%' || a.d || '%')
            or (a.d <> '' and s.amo_lead_id = a.d)
          )
        order by s.created_at desc
        limit (select lim from args)
      ) x), '[]'::jsonb) else '[]'::jsonb end,

    'calcs', case when p_calcs then coalesce((
      select jsonb_agg(r) from (
        select c.id, c.client_name, c.client_phone, c.order_number, c.deal_id, c.status, c.created_at
        from calculations c, args a
        where c.archived_at is null
          and (p_calc_owner is null or c.created_by = p_calc_owner)
          and (
            (length(a.q) >= 2 and c.client_name ilike '%' || a.q || '%')
            or (length(a.d) >= 4 and regexp_replace(coalesce(c.client_phone, ''), '\D', '', 'g') like '%' || a.d || '%')
            or (a.d <> '' and c.order_number ilike a.d || '%')
          )
        order by c.created_at desc
        limit (select lim from args)
      ) r), '[]'::jsonb) else '[]'::jsonb end
  );
$$;

revoke all on function public.app_search(text, text, boolean, int[], boolean, boolean, boolean, uuid, int) from public, anon;
grant execute on function public.app_search(text, text, boolean, int[], boolean, boolean, boolean, uuid, int) to authenticated;
