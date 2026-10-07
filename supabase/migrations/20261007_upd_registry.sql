-- ⛔ НЕ ВЫПОЛНЯТЬ (07.10.2026): реальные УПД выписывает бухгалтерская программа со своей
-- сквозной серией (№ 455 от 31.08 … № 532 от 29.09). Этот реестр начал бы вторую серию с № 1 —
-- одинаковые номера у разных документов. Решение — за владельцем, см. docs/b2b/ORDER_PANEL_ROUTE.md, этап 6.
--
-- Реестр УПД (карточка B2B-заказа, этап 5, 07.10.2026). Владелец решил: УПД клиенту
-- выписывается формой приложения — значит, нужен сквозной номер за год, а не номер заказа
-- (он не идёт подряд и может повторяться). Номер выдаётся один раз — при первой печати
-- или PDF — и дальше не меняется: повторная печать показывает тот же номер и дату.
create table if not exists upd_registry (
  id             bigint generated always as identity primary key,
  year           integer not null,
  number         integer not null check (number > 0),
  b2b_order_id   bigint  not null unique references b2b_orders(id) on delete restrict,
  doc_date       date    not null,
  issued_at      timestamptz not null default now(),
  issued_by      uuid references users(id) on delete set null,
  issued_by_name text,
  unique (year, number)
);

alter table upd_registry enable row level security;
-- Политик нет намеренно: читает и пишет только сервер (service role).
revoke all on upd_registry from anon, authenticated;

-- Выдача номера: идемпотентно по заказу, без гонок между двумя печатями — блокировка на год.
create or replace function assign_upd_number(p_order bigint, p_doc_date date, p_by uuid, p_by_name text)
returns table (year integer, number integer, doc_date date)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  y integer := extract(year from p_doc_date)::integer;
begin
  if not exists (select 1 from upd_registry u where u.b2b_order_id = p_order) then
    perform pg_advisory_xact_lock(hashtext('upd_registry'), y);
    insert into upd_registry (year, number, b2b_order_id, doc_date, issued_by, issued_by_name)
    values (y, coalesce((select max(u.number) from upd_registry u where u.year = y), 0) + 1,
            p_order, p_doc_date, p_by, p_by_name)
    on conflict (b2b_order_id) do nothing;
  end if;
  return query select u.year, u.number, u.doc_date from upd_registry u where u.b2b_order_id = p_order;
end $$;

-- REVOKE перед GRANT: иначе PUBLIC (и anon) получают EXECUTE по умолчанию.
revoke all on function assign_upd_number(bigint, date, uuid, text) from public;
revoke all on function assign_upd_number(bigint, date, uuid, text) from anon, authenticated;
grant execute on function assign_upd_number(bigint, date, uuid, text) to service_role;
