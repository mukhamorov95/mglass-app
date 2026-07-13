-- Отгрузки в Воронеж (и другие направления в будущем): партия = рейс машины.
-- Клиент относится к направлению через b2b_clients.crm_city (колонка уже есть,
-- 'Воронеж' — маркер). Заказы попадают в партию через delivery_shipment_orders;
-- суммы/вес считаются из items на лету, в партии фиксируются на момент отправки.

create table if not exists delivery_shipments (
  id serial primary key,
  region text not null default 'voronezh',
  title text,
  ship_date date,
  status text not null default 'draft' check (status in ('draft', 'shipped')),
  total_weight_kg numeric,
  total_amount numeric,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  shipped_at timestamptz
);

create table if not exists delivery_shipment_orders (
  shipment_id int not null references delivery_shipments(id) on delete cascade,
  order_id bigint not null references b2b_orders(id) on delete cascade,
  primary key (shipment_id, order_id)
);

create index if not exists delivery_shipments_region_status_idx
  on delivery_shipments (region, status);

alter table delivery_shipments enable row level security;
alter table delivery_shipment_orders enable row level security;

drop policy if exists ship_sel on delivery_shipments;
create policy ship_sel on delivery_shipments for select to authenticated using (true);
drop policy if exists ship_ins on delivery_shipments;
create policy ship_ins on delivery_shipments for insert to authenticated with check (true);
drop policy if exists ship_upd on delivery_shipments;
create policy ship_upd on delivery_shipments for update to authenticated using (true);
drop policy if exists ship_del on delivery_shipments;
create policy ship_del on delivery_shipments for delete to authenticated using (true);

drop policy if exists shipord_sel on delivery_shipment_orders;
create policy shipord_sel on delivery_shipment_orders for select to authenticated using (true);
drop policy if exists shipord_ins on delivery_shipment_orders;
create policy shipord_ins on delivery_shipment_orders for insert to authenticated with check (true);
drop policy if exists shipord_del on delivery_shipment_orders;
create policy shipord_del on delivery_shipment_orders for delete to authenticated using (true);
