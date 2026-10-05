-- Снимок дня менеджеров (manager_day_stats): «видеть все сделки» открывает всех только менеджеру.
--
-- Было: crm_caller().can_all = роль руководства ИЛИ can_view_all_deals у любой роли. Флаг
-- стоит у закупщика (для сделок), и он читал день всех менеджеров — замер 05.10: 238 строк,
-- 7 человек. Экран «Утро» читает service-ключом, политика его не затрагивает.
-- То же правило, что у manager_stats_* (20261006_manager_stats_own_rows.sql).

drop policy if exists manager_day_stats_select on public.manager_day_stats;
create policy manager_day_stats_select on public.manager_day_stats for select to authenticated using (
  exists (select 1 from crm_caller() c
          where c.u_role in ('admin', 'ceo', 'commercial', 'cfo') or (c.u_role = 'manager' and c.can_all))
  or amo_user_id = (select u.amo_user_id from public.users u where u.id = auth.uid())
);
