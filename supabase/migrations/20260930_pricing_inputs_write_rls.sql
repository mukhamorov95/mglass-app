-- Запись во входы цены — только тем, кто правит цены (30.09.2026).
--
-- Было: у financial_settings (маржа, налог, пороги — входят в каждую цену) и у
-- materials (закупочная cost_price) политики FOR ALL с предикатом NOT is_partner():
-- любой сотрудник — цех, бухгалтерия, менеджер — мог переписать их прямым запросом
-- к API со своим токеном, экран для этого не нужен.
--
-- Кто пишет в приложении:
--   financial_settings — только PUT /api/admin/settings, service-ключом за requireOwner;
--     политика его не касается.
--   materials — /admin/materials браузерным клиентом под RLS (открыт admin, ceo, buyer);
--     остальные — service-ключом: from-supplier и transfer (admin/ceo/buyer),
--     upload и warehouse (владелец), data-hub/import (admin/buyer), catalog/approve (владелец).
--
-- Стало: financial_settings — can_edit_pricing() (admin, ceo, commercial, cfo), как у
-- 15 прайсовых таблиц из 20260729_rls_wave2_pricing.sql. materials — то же плюс
-- закупщик: /admin/materials у него в ROLE_ALLOWED, и API заведения из поставщика и
-- переноса уже считают его редактором справочника. Чтение не меняется — auth_read_*
-- (NOT is_partner()) остаются; политики FOR ALL давали и SELECT, поэтому снимаются
-- только они.
--
-- Проба 30.09 до применения — откатываемые подтранзакции на живой базе: UPDATE реальной
-- строки, INSERT и DELETE фикстуры, ceo/commercial/cfo — переназначением реального
-- пользователя внутри отката; после — контрольные суммы таблиц, ролей и политик прежние.
--   было:  все роли, кроме партнёра, — UPDATE/INSERT/DELETE по 1 на обеих таблицах;
--   стало: admin, ceo, commercial, cfo — 1 на обеих; buyer — materials 1,
--          financial_settings 0 и отказ на INSERT; manager, production, accountant и
--          authenticated без sub — 0 и отказ на INSERT; партнёр — 0 (строк не видит);
--          anon — permission denied, как и раньше. Видимость строк у всех прежняя.

create or replace function public.can_edit_materials() returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_edit_pricing()
      or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'buyer')
$$;
revoke execute on function public.can_edit_materials() from public, anon;
grant execute on function public.can_edit_materials() to authenticated;

drop policy if exists "Auth manage materials" on public.materials;
drop policy if exists auth_all_materials on public.materials;
drop policy if exists auth_write_materials on public.materials;
drop policy if exists materials_insert on public.materials;
drop policy if exists materials_update on public.materials;
drop policy if exists materials_delete on public.materials;

create policy materials_insert on public.materials
  for insert to authenticated with check (public.can_edit_materials());
create policy materials_update on public.materials
  for update to authenticated using (public.can_edit_materials()) with check (public.can_edit_materials());
create policy materials_delete on public.materials
  for delete to authenticated using (public.can_edit_materials());

drop policy if exists auth_write_settings on public.financial_settings;
drop policy if exists financial_settings_insert on public.financial_settings;
drop policy if exists financial_settings_update on public.financial_settings;
drop policy if exists financial_settings_delete on public.financial_settings;

create policy financial_settings_insert on public.financial_settings
  for insert to authenticated with check (public.can_edit_pricing());
create policy financial_settings_update on public.financial_settings
  for update to authenticated using (public.can_edit_pricing()) with check (public.can_edit_pricing());
create policy financial_settings_delete on public.financial_settings
  for delete to authenticated using (public.can_edit_pricing());
