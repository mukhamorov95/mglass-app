-- Заявки на замер: запись только через /api/measure-requests* (service-role после
-- проверки прав в lib/measure/access.ts). Раньше политика FOR ALL USING (NOT is_partner())
-- давала любому сотруднику из браузера менять любое поле — в том числе отметить
-- гонорар замерщика «выплачено» или переназначить чужой замер.
-- Чтение не меняется: его читают /my-day, /clients/[phone], /crm/[id] под RLS.

drop policy if exists measure_requests_all on public.measure_requests;
drop policy if exists measure_requests_read on public.measure_requests;
create policy measure_requests_read on public.measure_requests
  for select to authenticated using (not public.is_partner());

-- Без гранта пропущенный писатель получает явную ошибку, а не молчаливые 0 строк.
revoke insert, update, delete on public.measure_requests from anon, authenticated;
