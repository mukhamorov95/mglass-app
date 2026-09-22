-- Себестоимость читалась без входа в систему.
--
-- Политики «anon_read» были выданы роли PUBLIC (в неё входит anon) с предикатом
-- not is_partner(); аноним его проходит, потому что is_partner() построен на
-- EXISTS, а EXISTS при пустом auth.uid() даёт false. Гранты SELECT у anon тоже
-- есть. Замер от имени anon до правки: financial_settings 7 строк (маржи, налог,
-- пороги), materials 11 и hardware_items 11 — с закупочными ценами.
-- Решение владельца 22.09.2026: «исправить это безобразие».
--
-- Закрываем только таблицы, у которых в коде нет ни одного публичного читателя:
-- все чтения идут либо с сервисным ключом (крон, конфигуратор), либо с экранов
-- под логином. Каталожные таблицы витрины (shower_models, mirror_lighting_tabs,
-- partner_types) НЕ трогаем — они могут быть публичными по замыслу.

drop policy if exists "anon_read" on financial_settings;
create policy "auth_read_financial_settings" on financial_settings
  for select to authenticated using (not is_partner());

drop policy if exists "anon_read_materials" on materials;
create policy "auth_read_materials" on materials
  for select to authenticated using (not is_partner());

drop policy if exists "anon_read" on hardware_items;
create policy "auth_read_hardware_items" on hardware_items
  for select to authenticated using (not is_partner());

drop policy if exists "anon_read" on services;
create policy "auth_read_services" on services
  for select to authenticated using (not is_partner());

drop policy if exists "anon_read" on coefficients;
create policy "auth_read_coefficients" on coefficients
  for select to authenticated using (not is_partner());

drop policy if exists "mfr_read" on mirror_frame_rates;
create policy "auth_read_mirror_frame_rates" on mirror_frame_rates
  for select to authenticated using (not is_partner());

drop policy if exists "mfref_read" on mirror_frame_refs;
create policy "auth_read_mirror_frame_refs" on mirror_frame_refs
  for select to authenticated using (not is_partner());

drop policy if exists "manager_stats_daily_read" on manager_stats_daily;
create policy "auth_read_manager_stats_daily" on manager_stats_daily
  for select to authenticated using (not is_partner());

drop policy if exists "manager_stats_monthly_read" on manager_stats_monthly;
create policy "auth_read_manager_stats_monthly" on manager_stats_monthly
  for select to authenticated using (not is_partner());

revoke select on financial_settings, materials, hardware_items, services, coefficients,
                 mirror_frame_rates, mirror_frame_refs, manager_stats_daily, manager_stats_monthly
  from anon;
