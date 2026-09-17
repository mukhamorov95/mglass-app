-- Повторная зачистка широких политик от партнёрских сессий.
-- 20260814 закрыла всё, что было открыто на тот день. Таблицы, созданные позже
-- (supplier_price_rows — 6 938 закупочных цен, glass_price_*, referral_*, marketing_*),
-- снова пришли с «using (true)» или «auth.uid() is not null», и вошедший партнёр
-- читал их через PostgREST. Персонал читает эти таблицы серверным ключом или как
-- не-партнёр, поэтому добавление NOT is_partner() его не затрагивает.

do $$
declare
  r record;
  uid_open constant text[] := array[
    '(auth.uid() IS NOT NULL)',
    '(( SELECT auth.uid() AS uid) IS NOT NULL)'
  ];
begin
  for r in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (roles && array['authenticated','public']::name[])
      and tablename <> 'users'
      and (qual = 'true' or with_check = 'true' or qual = any(uid_open) or with_check = any(uid_open))
  loop
    -- «true» остаётся открытым для анонима (как в 20260814), «uid is not null» — нет.
    if r.qual = 'true' then
      execute format('alter policy %I on %I.%I using (not is_partner())',
        r.policyname, r.schemaname, r.tablename);
    elsif r.qual = any(uid_open) then
      execute format('alter policy %I on %I.%I using ((select auth.uid()) is not null and not is_partner())',
        r.policyname, r.schemaname, r.tablename);
    end if;
    if r.with_check = 'true' then
      execute format('alter policy %I on %I.%I with check (not is_partner())',
        r.policyname, r.schemaname, r.tablename);
    elsif r.with_check = any(uid_open) then
      execute format('alter policy %I on %I.%I with check ((select auth.uid()) is not null and not is_partner())',
        r.policyname, r.schemaname, r.tablename);
    end if;
  end loop;
end $$;
