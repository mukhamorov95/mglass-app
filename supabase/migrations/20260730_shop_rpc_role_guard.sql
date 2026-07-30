-- №3: серверная авторизация в SECURITY DEFINER функциях отметок. _assert_shop_caller
-- пропускает вызовы сервис-ключом (auth.uid() null → авторизация на уровне роута),
-- а для реального юзера требует цеховую роль/владельца. Применено через MCP.
create or replace function _assert_shop_caller()
returns void language plpgsql security definer set search_path = public as $$
declare r text;
begin
  if auth.uid() is null then return; end if;
  select role into r from users where id = auth.uid();
  if r is null or r not in ('production','admin','ceo','buyer') then
    raise exception 'forbidden: shop action requires production role' using errcode = '42501';
  end if;
end $$;
-- mark_detail_stages / patch_order_notes_shallow дополнены `perform _assert_shop_caller()`
-- (полные тела — в 20260730_atomic_detail_stage_marks.sql + этот guard).
