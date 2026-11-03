-- Отгрузка клиенту по изделиям (Шовер Гласс, владелец 03.11.2026): какие строки заказа и сколько
-- штук уехало в какой отгрузке. Шапка — delivery_shipments, region отличает её от рейсов Воронежа.
-- Вес и сумма — снимок на момент отправки, в черновике пусты: заказ ещё могут поправить.
create table if not exists delivery_shipment_items (
  shipment_id integer not null references delivery_shipments(id) on delete cascade,
  order_id    bigint  not null references b2b_orders(id) on delete cascade,
  line_key    text    not null,
  qty         integer not null check (qty > 0),
  label       text,
  weight_kg   numeric,
  amount      numeric,
  created_at  timestamptz not null default now(),
  primary key (shipment_id, order_id, line_key)
);

create index if not exists delivery_shipment_items_order_idx on delivery_shipment_items (order_id);

-- Политик нет намеренно: читает и пишет только /api/production/client-shipments (service-role),
-- там же проверка роли. В строках суммы, цеху они не показываются.
alter table delivery_shipment_items enable row level security;
