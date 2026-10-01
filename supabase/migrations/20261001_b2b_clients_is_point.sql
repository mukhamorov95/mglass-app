-- Точка на стройрынке (решение владельца 01.10.2026, docs/partner-points/PARTNER_POINTS_ROUTE.md):
-- заказы точки цех делает первыми, в работу они уходят только после 100 % оплаты.
-- Признак ставит владелец в /admin/b2b-access (API — requireOwner).
alter table public.b2b_clients add column if not exists is_point boolean not null default false;

-- RLS b2b_clients пускает на запись любого сотрудника, поэтому requireOwner в API колонку
-- не закрывает: снять признак прямым запросом из браузера = отключить правило предоплаты,
-- поставить = пропустить свой заказ вперёд очереди цеха. Сервис-ключ и миграции проходят.
create or replace function public.guard_b2b_client_is_point() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon')
     and ((tg_op = 'INSERT' and new.is_point) or (tg_op = 'UPDATE' and new.is_point is distinct from old.is_point))
     and not public.is_owner() then
    raise exception using errcode = '42501', message = 'Признак «Точка» меняет только владелец';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_b2b_client_is_point on public.b2b_clients;
create trigger trg_guard_b2b_client_is_point
  before insert or update of is_point on public.b2b_clients
  for each row execute function public.guard_b2b_client_is_point();

-- Запуск заказа точки (launched_at из пустого в дату) — только при notes.payment_status = 'paid'.
-- API отказывает раньше и понятнее (lib/b2b/points.ts); триггер ловит прямую запись в обход API.
-- Перенос даты уже запущенного заказа не трогаем.
create or replace function public.guard_point_order_launch() returns trigger
language plpgsql set search_path = public as $$
declare pay text;
begin
  if new.launched_at is null or new.client_id is null
     or (tg_op = 'UPDATE' and old.launched_at is not null) then
    return new;
  end if;
  if not exists (select 1 from public.b2b_clients c where c.id = new.client_id and c.is_point) then
    return new;
  end if;
  begin
    pay := nullif(new.notes, '')::jsonb ->> 'payment_status';
  exception when others then
    pay := null;
  end;
  if pay is distinct from 'paid' then
    raise exception using errcode = 'P0001',
      message = 'Заказ точки уходит в работу только после 100 % оплаты. Отметьте «Оплачен» в колонке «Оплата» и запустите заказ снова.';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_point_order_launch on public.b2b_orders;
create trigger trg_guard_point_order_launch
  before insert or update of launched_at on public.b2b_orders
  for each row execute function public.guard_point_order_launch();
