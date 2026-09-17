-- Настройки агентов и очередь AI-задач меняет только владелец (17.09.2026).
--
-- Было: политика FOR ALL для любого сотрудника, кроме партнёра. Менеджер или рабочий
-- цеха из консоли браузера мог включить агента или выставить каталогу
-- require_approval=false — и агент сам писал бы в справочники материалов без одобрения.

create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (select 1 from public.users where id = auth.uid() and role in ('admin', 'ceo'));
$$;
revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

drop policy if exists "Auth manage agent_settings" on public.agent_settings;
create policy "Owner manage agent_settings" on public.agent_settings
  for all using (public.is_owner()) with check (public.is_owner());

drop policy if exists "task_queue_authed" on public.task_queue;
create policy "task_queue_read" on public.task_queue
  for select using (not public.is_partner());
create policy "task_queue_owner_write" on public.task_queue
  for all using (public.is_owner()) with check (public.is_owner());
