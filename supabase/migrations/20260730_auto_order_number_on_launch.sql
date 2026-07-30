-- Единый номер заказа: при запуске в работу, если своего номера нет, присваивается
-- 05066 = id с ведущими нулями (как в ленте «Новый заказ»). Триггер ловит все пути
-- запуска. Backfill проставил номер уже запущенным живым заказам. Применено через MCP.
create or replace function assign_order_number()
returns trigger language plpgsql as $$
begin
  if new.launched_at is not null
     and (new.custom_number is null or new.custom_number = '')
     and (new.client_order_number is null or new.client_order_number = '') then
    new.custom_number := lpad(new.id::text, 5, '0');
  end if;
  return new;
end $$;
drop trigger if exists trg_assign_order_number on b2b_orders;
create trigger trg_assign_order_number
  before insert or update of launched_at on b2b_orders
  for each row execute function assign_order_number();
update b2b_orders set custom_number = lpad(id::text, 5, '0')
where launched_at is not null and archived_at is null
  and (custom_number is null or custom_number = '')
  and (client_order_number is null or client_order_number = '');
