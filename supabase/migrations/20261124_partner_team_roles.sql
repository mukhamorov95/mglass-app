-- Команда партнёра (docs/PARTNER_TEAM_ROUTE.md, Т1): роль, имя, отключение; лимит мест у компании.
-- Существующие участники были «все равны» с полным доступом — им роль руководителя, чтобы ничего не отнять.
alter table b2b_client_members add column if not exists role text not null default 'admin';
alter table b2b_client_members add column if not exists name text;
alter table b2b_client_members add column if not exists disabled_at timestamptz;
alter table b2b_client_members add column if not exists invited_by_name text;
alter table b2b_client_members drop constraint if exists b2b_client_members_role_chk;
alter table b2b_client_members add constraint b2b_client_members_role_chk
  check (role in ('admin', 'manager', 'accountant', 'storekeeper'));
-- Новые приглашения указывают роль явно; умолчание — наименьшее право среди тех, кто видит цены.
alter table b2b_client_members alter column role set default 'manager';

alter table b2b_clients add column if not exists max_members int not null default 10;
alter table b2b_clients add column if not exists owner_name text;

-- Учётка, созданная приглашением партнёра, рождается партнёром: раньше триггер давал всем
-- 'manager' (роль сотрудника), и роль партнёра ставилась отдельным UPDATE — сбой между
-- ними оставлял внешнему человеку внутренние права.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.users (id, email, role, active)
  values (
    new.id, new.email,
    case when new.raw_app_meta_data->>'mglass_kind' = 'partner' then 'partner' else 'manager' end,
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$function$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
