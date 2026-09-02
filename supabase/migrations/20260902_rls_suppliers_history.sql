-- Ещё две таблицы с включённым RLS и без единой политики: запросы уходили,
-- ответ приходил успешный, данных не было.
--
-- suppliers — справочник контрагентов, читается выпадающим списком в админке
-- материалов (id, name, status). Цен в таблице нет, только контакты и сроки,
-- поэтому чтение сотрудникам безопасно. Запись не открываем: поставщиков
-- заводят через свой раздел под сервисным ключом.
drop policy if exists "Auth read suppliers" on public.suppliers;
create policy "Auth read suppliers"
  on public.suppliers for select to authenticated
  using (not is_partner());

-- b2b_client_manager_history — след смены менеджера у клиента. Код пишет строку
-- при каждой передаче клиента, но RLS её отбрасывал: в таблице 40 записей, все
-- от 19.05.2026 (разовый бэкфилл), и ни одной за три с половиной месяца.
-- То есть передачи происходили, а следа не оставалось.
drop policy if exists "Auth write client manager history" on public.b2b_client_manager_history;
create policy "Auth write client manager history"
  on public.b2b_client_manager_history for insert to authenticated
  with check (not is_partner());
drop policy if exists "Auth read client manager history" on public.b2b_client_manager_history;
create policy "Auth read client manager history"
  on public.b2b_client_manager_history for select to authenticated
  using (not is_partner());
