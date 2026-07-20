-- Настоящая RLS для CRM. До этого политики были USING(true): любой залогиненный
-- (включая цех) мог читать/менять ВСЕ лиды напрямую через anon-клиент — изоляция
-- менеджеров жила только в фильтрах на клиенте. Нарушение жёсткого правила №4
-- (данные одного менеджера недоступны другому).
--
-- Модель:
--  · admin/ceo/commercial или can_view_all_deals → видят всё;
--  · manager → свои лиды (manager = users.name) + общий пул (NULL / Иван (AI) /
--    Импорт с Авито) — чтобы можно было забрать необработанный лид;
--  · остальные роли (production, seo, buyer) → CRM не видят вообще;
--  · события/задачи/продажи наследуют видимость родительского лида;
--  · DELETE — только admin.
-- API-роуты на service-ключе (tasks, sales, вебхуки) не затронуты.

create or replace function public.crm_caller()
returns table (u_role text, u_name text, can_all boolean)
language sql stable security definer set search_path = public
as $$
  select role, name,
         role in ('admin','ceo','commercial') or coalesce(can_view_all_deals, false)
  from users where id = auth.uid()
$$;

drop policy if exists crm_leads_all on crm_leads;
drop policy if exists crm_events_all on crm_lead_events;
drop policy if exists crm_tasks_all on crm_tasks;
drop policy if exists crm_sales_all on crm_sales;

create policy crm_leads_select on crm_leads for select to authenticated using (
  exists (select 1 from crm_caller() c
    where c.u_role in ('manager','admin','ceo','commercial')
      and (c.can_all
           or crm_leads.manager = c.u_name
           or crm_leads.manager is null
           or crm_leads.manager in ('Иван (AI)', 'AI-менеджер', 'Импорт с Авито')))
);
create policy crm_leads_insert on crm_leads for insert to authenticated with check (
  exists (select 1 from crm_caller() c where c.u_role in ('manager','admin','ceo','commercial'))
);
create policy crm_leads_update on crm_leads for update to authenticated using (
  exists (select 1 from crm_caller() c
    where c.u_role in ('manager','admin','ceo','commercial')
      and (c.can_all
           or crm_leads.manager = c.u_name
           or crm_leads.manager is null
           or crm_leads.manager in ('Иван (AI)', 'AI-менеджер', 'Импорт с Авито')))
) with check (
  exists (select 1 from crm_caller() c where c.u_role in ('manager','admin','ceo','commercial'))
);
create policy crm_leads_delete on crm_leads for delete to authenticated using (
  exists (select 1 from crm_caller() c where c.u_role = 'admin')
);

-- Дочерние таблицы: видимость = видимость родительского лида (подзапрос к
-- crm_leads исполняется под RLS crm_leads — политика переиспользуется сама).
create policy crm_events_select on crm_lead_events for select to authenticated using (
  exists (select 1 from crm_leads l where l.id = crm_lead_events.lead_id)
);
create policy crm_events_insert on crm_lead_events for insert to authenticated with check (
  exists (select 1 from crm_leads l where l.id = crm_lead_events.lead_id)
);
create policy crm_events_delete on crm_lead_events for delete to authenticated using (
  exists (select 1 from crm_caller() c where c.u_role = 'admin')
);

create policy crm_tasks_select on crm_tasks for select to authenticated using (
  exists (select 1 from crm_leads l where l.id = crm_tasks.lead_id)
);
create policy crm_tasks_insert on crm_tasks for insert to authenticated with check (
  exists (select 1 from crm_leads l where l.id = crm_tasks.lead_id)
);
create policy crm_tasks_update on crm_tasks for update to authenticated using (
  exists (select 1 from crm_leads l where l.id = crm_tasks.lead_id)
);
create policy crm_tasks_delete on crm_tasks for delete to authenticated using (
  exists (select 1 from crm_caller() c where c.u_role = 'admin')
);

create policy crm_sales_select on crm_sales for select to authenticated using (
  exists (select 1 from crm_caller() c
    where c.u_role in ('manager','admin','ceo','commercial')
      and (c.can_all or crm_sales.manager = c.u_name))
);
create policy crm_sales_insert on crm_sales for insert to authenticated with check (
  exists (select 1 from crm_caller() c where c.u_role in ('manager','admin','ceo','commercial'))
);
create policy crm_sales_update on crm_sales for update to authenticated using (
  exists (select 1 from crm_caller() c
    where c.u_role in ('manager','admin','ceo','commercial')
      and (c.can_all or crm_sales.manager = c.u_name))
);
create policy crm_sales_delete on crm_sales for delete to authenticated using (
  exists (select 1 from crm_caller() c where c.u_role = 'admin')
);
