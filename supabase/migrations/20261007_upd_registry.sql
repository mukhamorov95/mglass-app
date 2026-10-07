-- Выдача УПД из приложения (docs/b2b/ORDER_PANEL_ROUTE.md, этап 7, 07.10.2026). Владелец решил:
-- приложение выписывает УПД вместо бухгалтерской программы и продолжает её серию (к 29.09
-- программа дошла до № 532). Номера выдаются только после того, как бухгалтер задал первый
-- номер серии на год (upd_series) — в момент, когда в программе УПД больше не выписывают.
-- Без этого функция отказывает: вторая серия с № 1 невозможна по построению, и выполнять
-- этот файл безопасно — он ничего не нумерует сам.

create table if not exists upd_series (
  year         integer primary key,
  start_number integer not null check (start_number > 0),
  set_at       timestamptz not null default now(),
  set_by       uuid references users(id) on delete set null,
  set_by_name  text
);

-- Выданный УПД неизменен: печать и PDF строятся из snapshot (строки, покупатель, итоги на
-- момент выдачи), а не из заказа — правка заказа после выдачи документ не меняет.
create table if not exists upd_registry (
  id              bigint generated always as identity primary key,
  year            integer not null,
  number          integer not null check (number > 0),
  b2b_order_id    bigint  not null unique references b2b_orders(id) on delete restrict,
  doc_date        date    not null,
  buyer_entity_id bigint  references b2b_client_legal_entities(id) on delete set null,
  buyer_name      text,
  buyer_inn       text,
  buyer_kpp       text,
  sum_no_vat      numeric(14,2) not null,
  vat             numeric(14,2) not null,
  sum_inc_vat     numeric(14,2) not null,
  snapshot        jsonb   not null,
  issued_at       timestamptz not null default now(),
  issued_by       uuid references users(id) on delete set null,
  issued_by_name  text,
  unique (year, number)
);
create index if not exists upd_registry_doc_date_idx on upd_registry (doc_date);

alter table upd_series enable row level security;
alter table upd_registry enable row level security;
-- Политик нет намеренно: читает и пишет только сервер (service role).
revoke all on upd_series from anon, authenticated;
revoke all on upd_registry from anon, authenticated;

-- Первый номер серии. Задаётся один раз на год и только до первой выдачи: после неё
-- сдвиг начала серии разорвал бы нумерацию.
create or replace function set_upd_series(p_year integer, p_start integer, p_by uuid, p_by_name text)
returns setof upd_series
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform pg_advisory_xact_lock(hashtext('upd_registry'), p_year);
  if exists (select 1 from upd_registry u where u.year = p_year) then
    raise exception 'upd_series_locked:%', p_year using errcode = 'P0001';
  end if;
  insert into upd_series (year, start_number, set_by, set_by_name)
  values (p_year, p_start, p_by, p_by_name)
  on conflict (year) do update
    set start_number = excluded.start_number, set_at = now(),
        set_by = excluded.set_by, set_by_name = excluded.set_by_name;
  return query select * from upd_series s where s.year = p_year;
end $$;

-- Выдача: идемпотентно по заказу (повтор возвращает тот же документ), без гонок — блокировка на год.
create or replace function issue_upd(
  p_order bigint, p_doc_date date, p_buyer_entity bigint, p_buyer_name text, p_buyer_inn text, p_buyer_kpp text,
  p_sum_no_vat numeric, p_vat numeric, p_sum_inc_vat numeric, p_snapshot jsonb,
  p_by uuid, p_by_name text
) returns setof upd_registry
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  y integer := extract(year from p_doc_date)::integer;
  s integer;
begin
  perform pg_advisory_xact_lock(hashtext('upd_registry'), y);
  if not exists (select 1 from upd_registry u where u.b2b_order_id = p_order) then
    select us.start_number into s from upd_series us where us.year = y;
    if s is null then
      raise exception 'upd_series_not_set:%', y using errcode = 'P0001';
    end if;
    insert into upd_registry (year, number, b2b_order_id, doc_date, buyer_entity_id, buyer_name, buyer_inn, buyer_kpp,
                              sum_no_vat, vat, sum_inc_vat, snapshot, issued_by, issued_by_name)
    values (y, greatest(coalesce((select max(u.number) from upd_registry u where u.year = y), 0), s - 1) + 1,
            p_order, p_doc_date, p_buyer_entity, p_buyer_name, p_buyer_inn, p_buyer_kpp,
            p_sum_no_vat, p_vat, p_sum_inc_vat, p_snapshot, p_by, p_by_name);
  end if;
  return query select * from upd_registry u where u.b2b_order_id = p_order;
end $$;

-- REVOKE перед GRANT: иначе PUBLIC (и anon) получают EXECUTE по умолчанию.
revoke all on function set_upd_series(integer, integer, uuid, text) from public;
revoke all on function set_upd_series(integer, integer, uuid, text) from anon, authenticated;
grant execute on function set_upd_series(integer, integer, uuid, text) to service_role;
revoke all on function issue_upd(bigint, date, bigint, text, text, text, numeric, numeric, numeric, jsonb, uuid, text) from public;
revoke all on function issue_upd(bigint, date, bigint, text, text, text, numeric, numeric, numeric, jsonb, uuid, text) from anon, authenticated;
grant execute on function issue_upd(bigint, date, bigint, text, text, text, numeric, numeric, numeric, jsonb, uuid, text) to service_role;
