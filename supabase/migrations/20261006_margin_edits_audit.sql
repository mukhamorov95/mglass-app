-- 1) Правки «Маржи» из приложения (просьба владельца 05.10: Вера дописывает пустые
--    ячейки объекта прямо в программе). Книга «Маржа» остаётся источником, утренняя
--    сверка переписывает margin_book_rows целиком — поэтому правки живут отдельно,
--    по продаже (crm_sales.id стабилен: книга продаж гасит строки, а не удаляет), и
--    накладываются поверх книги при чтении и в сверке. Ключ строки книги (номер
--    строки на листе) для правок не годится: вставка строки выше сдвинула бы правку
--    на чужой объект.
-- 2) Журнал действий: триггер пишет в activity_log, кто, когда и что изменил в
--    ключевых таблицах. Автор — auth.uid() (запрос ключом пользователя) или заголовок
--    x-mglass-actor, который ставит сервер, работая service-ключом от имени
--    проверенного пользователя (lib/supabase-service.ts). Ни того ни другого —
--    «система» (кроны, сверки книг).

create table if not exists public.margin_edits (
  sale_id        bigint not null references public.crm_sales(id) on delete cascade,
  field          text   not null check (field in (
                   'glass','hardware','designer','measurer','installer','delivery',
                   'partners','claims','tax','bonus_manager','bonus_ror','bonus_rop','closed')),
  value          numeric(14,2) not null check (value >= 0 and value < 1000000000),
  edited_by      uuid,
  edited_by_name text,
  edited_at      timestamptz not null default now(),
  primary key (sale_id, field),
  check (field <> 'closed' or value in (0, 1))
);

alter table public.margin_edits enable row level security;
revoke all on public.margin_edits from anon;
revoke insert, update, delete, truncate, references, trigger on public.margin_edits from authenticated;
grant select on public.margin_edits to authenticated;

-- Читают те же, кто читает книгу «Маржа», и обладатель права на правку маржи.
-- Пишет только сервер (service-role после проверки права в API).
drop policy if exists margin_edits_select on public.margin_edits;
create policy margin_edits_select on public.margin_edits for select to authenticated using (
  exists (select 1 from public.crm_caller() c where c.u_role in ('admin', 'ceo', 'cfo'))
  or exists (select 1 from public.users u where u.id = auth.uid() and (u.permissions ->> 'margin_edit') = 'true')
);

-- ── Журнал ────────────────────────────────────────────────────────────────────
-- Аргументы триггера: 1) ключевые колонки через запятую (по умолчанию id);
-- 2) колонки, которые не сравниваются и не пишутся (служебные отметки времени);
-- 3) «тяжёлые» колонки: изменение отмечается словом, без значений.
create or replace function public.audit_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  hdr       json;
  actor     uuid;
  actor_nm  text;
  keys      text[] := string_to_array(coalesce(nullif(tg_argv[0], ''), 'id'), ',');
  skip      text[] := string_to_array(coalesce(tg_argv[1], ''), ',') || array['updated_at', 'synced_at', 'import_batch'];
  heavy     text[] := string_to_array(coalesce(tg_argv[2], ''), ',');
  old_j     jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  new_j     jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  cur       jsonb := coalesce(new_j, old_j);
  diff      jsonb := '{}';
  snap      jsonb;
  k         text;
  ent       text;
begin
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(new_j) loop
      continue when k = any(skip);
      if (old_j -> k) is distinct from (new_j -> k) then
        diff := diff || jsonb_build_object(k, case when k = any(heavy) then '"изменено"'::jsonb
                                                  else jsonb_build_array(old_j -> k, new_j -> k) end);
      end if;
    end loop;
    if diff = '{}'::jsonb then return null; end if;
  else
    snap := cur;
    foreach k in array skip loop snap := snap - k; end loop;
    foreach k in array heavy loop snap := snap - k; end loop;
  end if;

  begin
    hdr := nullif(current_setting('request.headers', true), '')::json;
  exception when others then hdr := null;
  end;
  actor := auth.uid();
  if actor is null and hdr ->> 'x-mglass-actor' ~ '^[0-9a-f-]{36}$' then
    actor := (hdr ->> 'x-mglass-actor')::uuid;
  end if;
  if actor is not null then select coalesce(u.name, u.email) into actor_nm from public.users u where u.id = actor; end if;

  select string_agg(coalesce(cur ->> trim(x), '∅'), ' · ') into ent from unnest(keys) x;

  insert into public.activity_log (user_id, user_name, action, entity_type, entity_id, details)
  values (
    actor,
    coalesce(actor_nm, case when actor is null then 'система' else 'неизвестный пользователь' end),
    'row.' || lower(tg_op),
    tg_table_name,
    ent,
    case when tg_op = 'UPDATE' then jsonb_build_object('changes', diff, 'row', jsonb_strip_nulls(jsonb_build_object(
           'order_no', cur -> 'order_no', 'client', cur -> 'client', 'name', cur -> 'name',
           'number', cur -> 'number', 'client_name', cur -> 'client_name', 'manager', cur -> 'manager')))
         else jsonb_build_object('row', snap) end
  );
  return null;
end $$;

revoke all on function public.audit_change() from public, anon, authenticated;

-- Ключевые таблицы: деньги, продажи, маржа, планы, доступы, документы, справочники цен.
do $$
declare t record;
begin
  for t in select * from (values
    ('crm_sales',            'id',                '',  ''),
    ('margin_edits',         'sale_id,field',     'edited_at,edited_by,edited_by_name',  ''),
    ('manager_month_plans',  'month,amo_user_id', '',  ''),
    ('users',                'id',                '',  ''),
    ('payments',             'id',                '',  ''),
    ('commercial_proposals', 'id',                '',  'items,content,photos,raw_transcript'),
    ('contracts',            'id',                '',  'spec,content'),
    ('calculations',         'id',                '',  'input_data,cost_breakdown,financial_breakdown,client_text'),
    ('financial_settings',   'id',                '',  ''),
    ('earnings_settings',    'id',                '',  'commission_tiers,streak_bonuses'),
    ('b2b_rates',            'key',               '',  ''),
    ('manager_schedules',    'amo_user_id',       '',  '')
  ) v(tbl, keys, skip, heavy) loop
    if to_regclass('public.' || t.tbl) is null then continue; end if;
    execute format('drop trigger if exists audit_change on public.%I', t.tbl);
    execute format('create trigger audit_change after insert or update or delete on public.%I
                    for each row execute function public.audit_change(%L, %L, %L)', t.tbl, t.keys, t.skip, t.heavy);
  end loop;
end $$;

create index if not exists activity_log_created_at_idx on public.activity_log (created_at desc);
create index if not exists activity_log_entity_idx on public.activity_log (entity_type, entity_id);
