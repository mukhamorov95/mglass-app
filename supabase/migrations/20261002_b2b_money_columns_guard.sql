-- Деньги и доступ в b2b_clients / b2b_orders держатся в базе (02.10.2026).
--
-- RLS обеих таблиц пускает на запись любого сотрудника, кроме партнёра, во все колонки,
-- а patch_order_notes_shallow и mark_order_stages — SECURITY DEFINER с широкими списками
-- ролей. Из браузера цех писал notes.payment_status, менеджер — stages.invoice_paid, и
-- калитка запуска заказа точки (#800) верила этой отметке. Колонки скидки, доступа к
-- кабинету и суммы запущенного заказа были открыты так же.
--
-- «Из браузера» — роль запроса authenticated/anon по current_user ИЛИ по роли в JWT:
-- внутри SECURITY DEFINER current_user — владелец функции, а JWT остаётся вызывающего,
-- поэтому гард ловит и прямой PATCH, и запись через RPC. Сервис-ключ (серверные маршруты
-- со своей проверкой прав) и миграции проходят. Владелец — is_owner().

create or replace function public._is_browser_write() returns boolean
language sql stable set search_path = public as $$
  select current_user in ('authenticated', 'anon')
      or coalesce(auth.role(), '') in ('authenticated', 'anon')
$$;

-- Кто правит деньги просчёта из браузера, кроме владельца: те, кому открыт /calculator/b2b.
-- Список сверяет с canAccessRoute __tests__/access/b2bMoneyGuard.test.ts — разойдутся, тест упадёт.
create or replace function public.b2b_money_editor_roles() returns text[]
language sql immutable as $$ select array['manager', 'buyer'] $$;

create or replace function public._b2b_caller() returns table (role text, max_discount numeric)
language sql stable security definer set search_path = public as $$
  select u.role, u.max_discount_percent from public.users u where u.id = auth.uid()
$$;
revoke all on function public._b2b_caller() from public, anon;
grant execute on function public._b2b_caller() to authenticated, service_role;

-- Ключи notes, которые пишет только сервер: оплата (/api/b2b-orders/[id]/payment),
-- согласование цены и история суммы (просчёты, владелец). Тот же список —
-- SERVER_ONLY_NOTE_KEYS в lib/b2b/orderNotes.ts. JSON null = ключа нет.
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
    'prepayment_amount', n -> 'prepayment_amount',
    'paid_at',           n -> 'paid_at',
    'payments',          n -> 'payments',
    'price_approval',    n -> 'price_approval',
    'total_history',     n -> 'total_history',
    'stages.invoice_paid', case when jsonb_typeof(n -> 'stages') = 'object' then n -> 'stages' -> 'invoice_paid' end
  ));
end $$;

create or replace function public.guard_b2b_order_money() returns trigger
language plpgsql set search_path = public as $$
declare
  c record;
  pay text;
begin
  if not public._is_browser_write() then return new; end if;

  -- Оплату и согласование из браузера не пишет никто, владелец тоже: у оплаты один
  -- писатель, он же ведёт payments и ведомость продаж — прямая запись их рассинхронит.
  if public._b2b_order_money_keys(new.notes) is distinct from
     (case when tg_op = 'INSERT' then '{}'::jsonb else public._b2b_order_money_keys(old.notes) end) then
    raise exception using errcode = '42501',
      message = 'Оплату заказа отмечает только колонка «Оплата», согласование цены — владелец. Прямая запись этих полей закрыта.';
  end if;

  if public.is_owner() then return new; end if;

  if tg_op = 'INSERT'
     or (new.items, new.discount_percent, new.margin_percent, new.total_area, new.total_weight,
         new.total_cost_net, new.total_cost_vat, new.total_sale_inc_vat, new.total_after_discount, new.client_id)
        is distinct from
        (old.items, old.discount_percent, old.margin_percent, old.total_area, old.total_weight,
         old.total_cost_net, old.total_cost_vat, old.total_sale_inc_vat, old.total_after_discount, old.client_id) then
    select * into c from public._b2b_caller();
    if c.role is null or not (c.role = any (public.b2b_money_editor_roles())) then
      raise exception using errcode = '42501', message = 'Позиции, суммы и клиента заказа правят менеджер и владелец.';
    end if;
    if tg_op = 'UPDATE' then
      -- Сумма запущенного заказа — у владельца (/api/b2b-orders/[id]/adjust-total);
      -- менеджер возвращает заказ в просчёт, и запуск заново проходит калитки.
      if old.launched_at is not null then
        raise exception using errcode = '42501',
          message = 'Заказ уже в работе: позиции и сумму меняет владелец («Корректировка итога» в «Заказах»). Или верните заказ в просчёт и запустите заново.';
      end if;
      -- «Оплачен» — это 100 % от суммы на момент отметки; поднять сумму после неё
      -- значит запустить точку с недоплатой.
      begin
        pay := nullif(old.notes, '')::jsonb ->> 'payment_status';
      exception when others then
        pay := null;
      end;
      if pay = 'paid' then
        raise exception using errcode = '42501',
          message = 'Заказ отмечен оплаченным: сумму меняет владелец. Или сначала снимите отметку «Оплачен» в колонке «Оплата».';
      end if;
    end if;
  end if;

  if tg_op = 'INSERT' then
    if new.created_by is not null and new.created_by <> auth.uid()::text then
      raise exception using errcode = '42501', message = 'Автор просчёта — тот, кто его создаёт.';
    end if;
  elsif new.created_by is distinct from old.created_by or new.organization_id is distinct from old.organization_id then
    raise exception using errcode = '42501', message = 'Автора и организацию заказа меняет владелец.';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_b2b_order_money on public.b2b_orders;
create trigger trg_guard_b2b_order_money
  before insert or update of notes, items, discount_percent, margin_percent, total_area, total_weight,
    total_cost_net, total_cost_vat, total_sale_inc_vat, total_after_discount, client_id, created_by, organization_id
  on public.b2b_orders
  for each row execute function public.guard_b2b_order_money();

-- Клиент: доступ к кабинету (user_id), самовыставление счетов, тестовый признак,
-- организацию и ответственного меняет владелец (в UI это его экраны и requireOwner).
-- Скидку — менеджер в пределах своего лимита users.max_discount_percent (его задаёт
-- владелец в /admin/users), выше — владелец. Признак «Точка» — guard_b2b_client_is_point.
create or replace function public.guard_b2b_client_money() returns trigger
language plpgsql set search_path = public as $$
declare c record;
begin
  if not public._is_browser_write() or public.is_owner() then return new; end if;

  if tg_op = 'INSERT' then
    if coalesce(new.can_self_invoice, false) or new.user_id is not null or coalesce(new.is_test, false)
       or (new.manager_id is not null and new.manager_id is distinct from auth.uid()) then
      raise exception using errcode = '42501',
        message = 'Кабинет партнёра, самовыставление счетов, тестовый признак и чужого ответственного ставит владелец.';
    end if;
  elsif (new.can_self_invoice, new.user_id, new.is_test, new.organization_id, new.manager_id)
        is distinct from (old.can_self_invoice, old.user_id, old.is_test, old.organization_id, old.manager_id) then
    raise exception using errcode = '42501',
      message = 'Кабинет партнёра, самовыставление счетов, организацию и ответственного менеджера меняет владелец.';
  end if;

  if (tg_op = 'INSERT' and coalesce(new.discount_percent, 0) <> 0)
     or (tg_op = 'UPDATE' and new.discount_percent is distinct from old.discount_percent) then
    select * into c from public._b2b_caller();
    if c.role is null or not (c.role = any (public.b2b_money_editor_roles())) then
      raise exception using errcode = '42501', message = 'Скидку клиента меняют менеджер и владелец.';
    end if;
    if coalesce(new.discount_percent, 0) > coalesce(c.max_discount, 0) then
      raise exception using errcode = '42501',
        message = format('Скидка %s %% выше вашего лимита %s %% — её ставит владелец.', new.discount_percent, coalesce(c.max_discount, 0));
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_b2b_client_money on public.b2b_clients;
create trigger trg_guard_b2b_client_money
  before insert or update of discount_percent, can_self_invoice, user_id, is_test, organization_id, manager_id
  on public.b2b_clients
  for each row execute function public.guard_b2b_client_money();

-- Аноним не пишет в эти таблицы ни одним путём (политики требуют authenticated);
-- грант на запись — лишний слой доверия к RLS.
revoke insert, update, delete, truncate on public.b2b_clients, public.b2b_orders from anon;
