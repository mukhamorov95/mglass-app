-- Прогон доступов смотрит и в хранилище.
--
-- 01.10.2026 две дыры нашлись в бакетах, а не в таблицах: b2b-attachments отдавал
-- партнёру чертежи всех заказчиков, в furniture-shower писал аноним. Снимок прав
-- (security_access_snapshot) бакеты не читал, и ежемесячный прогон о них молчал.
--
-- Функция пересоздаётся с прежними разделами (текст — как в живой базе на 14.10,
-- с 'check') и новым разделом storage: бакеты (публичность, лимит размера, типы
-- файлов, число файлов) и политики storage.objects. Выводы — в
-- lib/security/accessAudit.ts (auditStorage). Ни бакеты, ни политики миграция не
-- трогает — только читает.

create or replace function public.security_access_snapshot()
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
        'using', pg_get_expr(p.polqual, p.polrelid),
        'check', pg_get_expr(p.polwithcheck, p.polrelid)
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
    ),
    'storage', jsonb_build_object(
      'buckets', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', b.id,
          'public', b.public,
          'file_size_limit', b.file_size_limit,
          'allowed_mime_types', b.allowed_mime_types,
          'objects', (select count(*) from storage.objects o where o.bucket_id = b.id)
        ) order by b.id), '[]'::jsonb)
        from storage.buckets b
      ),
      'policies', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'table', c.relname,
          'policy', p.polname,
          'cmd', p.polcmd,
          'roles', (select coalesce(array_agg(r.rolname), array['PUBLIC']) from pg_roles r where r.oid = any(p.polroles)),
          'using', pg_get_expr(p.polqual, p.polrelid),
          'check', pg_get_expr(p.polwithcheck, p.polrelid)
        ) order by p.polname), '[]'::jsonb)
        from pg_policy p
        join pg_class c on c.oid = p.polrelid
        join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'storage'
        where c.relname = 'objects'
      )
    )
  );
$$;

revoke all on function public.security_access_snapshot() from public, anon, authenticated;
grant execute on function public.security_access_snapshot() to service_role;
