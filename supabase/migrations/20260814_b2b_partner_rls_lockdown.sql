-- Изоляция перед запуском внешнего B2B-кабинета: сессия партнёра (authenticated,
-- role='partner') не должна доставать чужие/внутренние данные напрямую через PostgREST.

-- П.1 — users: убрать публичное чтение таблицы и плейнтекст-паролей.
-- Политика «Anyone can read user names» (SELECT to public, qual=true) + грант
-- anon/authenticated на password_plain позволяли любому с anon-ключом выкачать
-- пароли персонала. Персонал логинится через Supabase Auth (не через
-- password_plain), поэтому закрытие безопасно.
drop policy if exists "Anyone can read user names" on public.users;
create policy users_read_staff on public.users for select to authenticated
  using (id = auth.uid() or not is_partner());
revoke select (password_plain), insert (password_plain), update (password_plain)
  on public.users from anon, authenticated;

-- П.2 — заблокировать партнёрские сессии на всех «широких» (qual/with_check = true)
-- политиках внутренних таблиц: добавляем NOT is_partner() только там, где было
-- полностью открыто. Персонал (не партнёр) и анонимный доступ (публичные
-- каталоги/конфигуратор) не затрагиваются. Рабочие политики b2b_orders/b2b_clients
-- (партнёр видит свои заказы по user_id) уже скоупованы и под фильтр не попадают.
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (roles && array['authenticated','public']::name[])
      and (qual = 'true' or with_check = 'true')
      and tablename <> 'users'
  loop
    if r.qual = 'true' and r.with_check = 'true' then
      execute format('alter policy %I on %I.%I using (not is_partner()) with check (not is_partner())', r.policyname, r.schemaname, r.tablename);
    elsif r.qual = 'true' then
      execute format('alter policy %I on %I.%I using (not is_partner())', r.policyname, r.schemaname, r.tablename);
    elsif r.with_check = 'true' then
      execute format('alter policy %I on %I.%I with check (not is_partner())', r.policyname, r.schemaname, r.tablename);
    end if;
  end loop;
end $$;
