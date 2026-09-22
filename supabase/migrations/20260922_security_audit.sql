-- Ежемесячный прогон «кто что видит».
--
-- 22.09.2026 за один день нашлись: пароли открытым текстом в колонке, анонимное
-- чтение и запись справочников, партнёр с нашей себестоимостью, реквизиты счёта
-- любому вошедшему. Все четыре — одного класса: право выдано шире, чем думали,
-- и никто об этом не узнавал, пока не посмотрел руками. Значит смотреть должна
-- машина и по расписанию.
--
-- Функция отдаёт СНИМОК прав (политики, гранты, состояние RLS, подозрительные
-- колонки). Выводы делает код (lib/security/accessAudit.ts) — так их можно
-- покрыть тестами и менять без миграции.

create table if not exists security_audit_runs (
  id          bigserial primary key,
  created_at  timestamptz not null default now(),
  findings    jsonb       not null default '[]'::jsonb,
  high        int         not null default 0,
  medium      int         not null default 0,
  low         int         not null default 0,
  snapshot    jsonb
);

alter table security_audit_runs enable row level security;

drop policy if exists "Owner reads security audit" on security_audit_runs;
create policy "Owner reads security audit" on security_audit_runs
  for select to authenticated using (not is_partner());

create or replace function security_access_snapshot()
returns jsonb
language sql
security definer
set search_path = public, pg_catalog
as $$
  select jsonb_build_object(
    'policies', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'table', c.relname,
        'policy', p.polname,
        'cmd', p.polcmd,
        'roles', (select coalesce(array_agg(r.rolname), array['PUBLIC']) from pg_roles r where r.oid = any(p.polroles)),
        'using', pg_get_expr(p.polqual, p.polrelid)
      )), '[]'::jsonb)
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
    ),
    'grants', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'table', table_name, 'grantee', grantee, 'privilege', privilege_type
      )), '[]'::jsonb)
      from information_schema.role_table_grants
      where table_schema = 'public' and grantee in ('anon', 'authenticated')
    ),
    'rls', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'table', c.relname,
        'enabled', c.relrowsecurity,
        'policies', (select count(*) from pg_policy p where p.polrelid = c.oid)
      )), '[]'::jsonb)
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      where c.relkind = 'r'
    ),
    'suspicious_columns', (
      select coalesce(jsonb_agg(jsonb_build_object('table', table_name, 'column', column_name)), '[]'::jsonb)
      from information_schema.columns
      where table_schema = 'public'
        and (column_name ilike '%password%' or column_name ilike '%secret%' or column_name ilike '%token_plain%')
    )
  );
$$;

revoke all on function security_access_snapshot() from public, anon, authenticated;
grant execute on function security_access_snapshot() to service_role;
