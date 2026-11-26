-- А0.1 (26.11.2026): права записи в заказы B2B, которые держит база. Круг редакторов не меняется.
--  1. own_cost_remake — ключ денег: отметка обнуляет долг клиента, а защищён он был только в API.
--     Пишет только сервер (/api/b2b-orders/[id]/own-cost).
--  2. patch_order_notes_shallow принимала от вошедших любые ключи. Из браузера — только те,
--     что действительно шлют экраны цеха; серверные маршруты идут сервис-ключом.
--  3. Дата запуска (колонка launched_at и notes.launched_at) — только тем, кому открыт
--     /b2b-quotes (там маршрут запуска пишет колонку под сессией вошедшего), и владельцу.
--  4. Журнал: деньги, даты запуска, архив и удаление заказа — в activity_log.
--  5. Цены отверстий (в таблице есть себестоимость) партнёр не читает.
-- Списки сверяют с кодом __tests__/access/b2bMoneyGuard.test.ts, права — econOrderGuard.test.ts.
-- Откат: supabase/rollbacks/20261126_econ_a0_1_guard_audit.down.sql

create or replace function public._b2b_order_money_keys(p_notes text) returns jsonb
language plpgsql immutable set search_path = public as $$
declare n jsonb;
begin
  begin
    n := nullif(p_notes, '')::jsonb;
  exception when others then
    return '{}'::jsonb;
  end;
  if n is null or jsonb_typeof(n) <> 'object' then return '{}'::jsonb; end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'payment_status',    n -> 'payment_status',
    'payment_source',    n -> 'payment_source',
    'prepayment_amount', n -> 'prepayment_amount',
    'paid_at',           n -> 'paid_at',
    'payments',          n -> 'payments',
    'price_approval',    n -> 'price_approval',
    'total_history',     n -> 'total_history',
    'own_cost_remake',   n -> 'own_cost_remake',
    'stages.invoice_paid', case when jsonb_typeof(n -> 'stages') = 'object' then n -> 'stages' -> 'invoice_paid' end
  ));
end $$;

create or replace function public._b2b_notes_launched_at(p_notes text) returns text
language plpgsql immutable set search_path = public as $$
begin
  return nullif(p_notes, '')::jsonb ->> 'launched_at';
exception when others then
  return null;
end $$;

create or replace function public.b2b_launch_editor_roles() returns text[]
language sql immutable as $$ select array['manager', 'buyer'] $$;

-- Отдельный триггер, а не правка guard_b2b_order_money: тот держит деньги и остаётся как есть.
create or replace function public.guard_b2b_order_launch_date() returns trigger
language plpgsql set search_path = public as $$
declare c record;
begin
  if not public._is_browser_write() then return new; end if;

  if tg_op = 'INSERT' then
    if new.launched_at is null and public._b2b_notes_launched_at(new.notes) is null then return new; end if;
  elsif new.launched_at is not distinct from old.launched_at
    and public._b2b_notes_launched_at(new.notes) is not distinct from public._b2b_notes_launched_at(old.notes) then
    return new;
  end if;

  if public.is_owner() then return new; end if;
  select * into c from public._b2b_caller();
  if c.role is null or not (c.role = any (public.b2b_launch_editor_roles())) then
    raise exception using errcode = '42501', message = 'Дату запуска заказа меняют менеджер, закупщик и владелец.';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_b2b_order_launch_date on public.b2b_orders;
create trigger trg_guard_b2b_order_launch_date
  before insert or update of launched_at, notes on public.b2b_orders
  for each row execute function public.guard_b2b_order_launch_date();

-- Ключи, которые экраны цеха шлют из браузера: production-app/orders (чертёж), orders/[id]
-- (срочность, отмена этапа), my-queue и MaterialCheck (материал).
create or replace function public.b2b_browser_note_keys() returns text[]
language sql immutable as $$
  select array['drawing_url', 'urgent', 'detail_stages', 'detail_stage_audit',
               'material_status', 'material_checked_at', 'material_checked_by', 'material_needed_items']
$$;

create or replace function public.patch_order_notes_shallow(p_order_id bigint, p_patch jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  n jsonb;
  extra text;
begin
  perform _assert_shop_caller();
  if public._is_browser_write() then
    select string_agg(k, ', ' order by k) into extra
      from jsonb_object_keys(p_patch) k
     where not (k = any (public.b2b_browser_note_keys()));
    if extra is not null then
      raise exception using errcode = '42501', message = format('Эти поля заказа из браузера не пишутся: %s', extra);
    end if;
  end if;
  select coalesce(nullif(notes, '')::jsonb, '{}'::jsonb) into n
  from b2b_orders where id = p_order_id for update;
  if n is null then n := '{}'::jsonb; end if;
  update b2b_orders set notes = (n || p_patch)::text where id = p_order_id;
end $$;

-- Журнал колонок — общей функцией audit_change; items и notes без содержимого.
drop trigger if exists trg_audit_b2b_orders on public.b2b_orders;
create trigger trg_audit_b2b_orders
  after delete or update of items, discount_percent, margin_percent, total_cost_net, total_cost_vat,
    total_sale_inc_vat, total_after_discount, client_id, payer_client_id, launched_at, archived_at
  on public.b2b_orders
  for each row execute function public.audit_change('id', 'updated_by_user_id,updated_by_name', 'items,notes');

-- Денежные ключи лежат внутри notes, которые цех правит сотни раз в день: в журнал идёт
-- только изменение самих ключей, а не всей строки.
create or replace function public.audit_b2b_order_note_money() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  before_j jsonb := public._b2b_order_money_keys(old.notes)
    || jsonb_strip_nulls(jsonb_build_object('notes.launched_at', public._b2b_notes_launched_at(old.notes)));
  after_j jsonb := public._b2b_order_money_keys(new.notes)
    || jsonb_strip_nulls(jsonb_build_object('notes.launched_at', public._b2b_notes_launched_at(new.notes)));
  diff jsonb := '{}';
  hdr json;
  actor uuid;
  actor_nm text;
  k text;
begin
  if before_j = after_j then return null; end if;
  for k in select jsonb_object_keys(before_j || after_j) loop
    if (before_j -> k) is distinct from (after_j -> k) then
      diff := diff || jsonb_build_object(k, jsonb_build_array(before_j -> k, after_j -> k));
    end if;
  end loop;
  begin
    hdr := nullif(current_setting('request.headers', true), '')::json;
  exception when others then hdr := null;
  end;
  actor := auth.uid();
  if actor is null and hdr ->> 'x-mglass-actor' ~ '^[0-9a-f-]{36}$' then
    actor := (hdr ->> 'x-mglass-actor')::uuid;
  end if;
  if actor is not null then select coalesce(u.name, u.email) into actor_nm from public.users u where u.id = actor; end if;
  insert into public.activity_log (user_id, user_name, action, entity_type, entity_id, details)
  values (actor, coalesce(actor_nm, case when actor is null then 'система' else 'неизвестный пользователь' end),
          'row.update', 'b2b_orders', new.id::text,
          jsonb_build_object('changes', diff, 'row', jsonb_strip_nulls(jsonb_build_object('client_name', new.client_name))));
  return null;
end $$;
revoke all on function public.audit_b2b_order_note_money() from public, anon, authenticated;

drop trigger if exists trg_audit_b2b_order_note_money on public.b2b_orders;
create trigger trg_audit_b2b_order_note_money
  after update of notes on public.b2b_orders
  for each row when (old.notes is distinct from new.notes)
  execute function public.audit_b2b_order_note_money();

drop policy if exists b2b_hole_prices_read on public.b2b_hole_prices;
create policy b2b_hole_prices_read on public.b2b_hole_prices
  for select to authenticated using (not public.is_partner());
