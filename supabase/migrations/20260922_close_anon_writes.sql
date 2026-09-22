-- Запись в справочники без входа в систему.
--
-- Политики были выданы роли PUBLIC (в неё входит anon) с предикатом
-- `not is_partner()`. is_partner() построен на EXISTS, а EXISTS при пустом
-- auth.uid() даёт false → NOT false = true, то есть аноним проходит. Гранты
-- INSERT/UPDATE/DELETE у anon тоже есть (дефолт Supabase). Итог: любой человек
-- с публичным ключом из бандла мог переписать себестоимость в materials —
-- а от неё считаются цены во всех калькуляторах.
--
-- Чиним ровно запись и ровно для анонима: те же предикаты, но TO authenticated,
-- чтобы экраны сотрудников продолжали работать. Чтение не трогаем — его
-- разбираем отдельно, там могут быть публичные страницы.

-- materials
drop policy if exists "anon_all_materials" on materials;
create policy "auth_all_materials" on materials
  for all to authenticated using (not is_partner()) with check (not is_partner());

-- purchase_orders (канбан закупок пишет с клиента сотрудника)
drop policy if exists "service role bypass" on purchase_orders;
create policy "auth_manage_purchase_orders" on purchase_orders
  for all to authenticated using (not is_partner()) with check (not is_partner());

-- маршруты закупки
drop policy if exists "service role bypass" on procurement_routes;
create policy "auth_manage_procurement_routes" on procurement_routes
  for all to authenticated using (not is_partner()) with check (not is_partner());

drop policy if exists "service role bypass" on procurement_route_stops;
create policy "auth_manage_procurement_route_stops" on procurement_route_stops
  for all to authenticated using (not is_partner()) with check (not is_partner());

-- ставки и образцы рам зеркал
drop policy if exists "mfr_insert" on mirror_frame_rates;
drop policy if exists "mfr_update" on mirror_frame_rates;
create policy "auth_write_mirror_frame_rates" on mirror_frame_rates
  for all to authenticated using (not is_partner()) with check (not is_partner());

drop policy if exists "mfref_insert" on mirror_frame_refs;
drop policy if exists "mfref_delete" on mirror_frame_refs;
create policy "auth_write_mirror_frame_refs" on mirror_frame_refs
  for all to authenticated using (not is_partner()) with check (not is_partner());

-- Гранты записи анониму не нужны ни на одной из этих таблиц.
revoke insert, update, delete on materials from anon;
revoke insert, update, delete on purchase_orders from anon;
revoke insert, update, delete on procurement_routes from anon;
revoke insert, update, delete on procurement_route_stops from anon;
revoke insert, update, delete on mirror_frame_rates from anon;
revoke insert, update, delete on mirror_frame_refs from anon;
revoke insert, update, delete on financial_settings from anon;
revoke insert, update, delete on hardware_items from anon;
revoke insert, update, delete on services from anon;
revoke insert, update, delete on coefficients from anon;
