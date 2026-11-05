-- Закалка (владелец 05.11.2026): лист на закалку из заказов и изделий, приёмка, бой, история.
-- RLS без политик: читает и пишет только маршрут /api/production/tempering после проверки роли
-- (в строках себестоимость закалки и продажная сумма).

create table if not exists public.tempering_batches (
  id            serial primary key,
  batch_date    date not null,
  status        text not null default 'draft' check (status in ('draft', 'sent')),
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  sent_at       timestamptz,
  sent_by       uuid references auth.users(id),
  sent_by_name  text
);

create table if not exists public.tempering_batch_items (
  id                bigserial primary key,
  batch_id          int not null references public.tempering_batches(id) on delete cascade,
  order_id          bigint not null references public.b2b_orders(id),
  line_key          text not null,
  layer             int not null default 1,
  item_index        int not null,
  qty               int not null check (qty > 0),
  order_no          text not null,
  material          text not null,
  thickness         numeric,
  width             numeric,
  height            numeric,
  area_m2           numeric not null default 0,
  weight_kg         numeric not null default 0,
  rate_per_m2       numeric,
  cost              numeric,
  transport         numeric not null default 0,
  amount            numeric not null default 0,
  returned_qty      int not null default 0 check (returned_qty >= 0),
  broken_qty        int not null default 0 check (broken_qty >= 0),
  received_at       timestamptz,
  received_by_name  text,
  unique (batch_id, order_id, line_key, layer),
  check (returned_qty + broken_qty <= qty)
);

create index if not exists tempering_batch_items_order_idx on public.tempering_batch_items (order_id);

alter table public.tempering_batches enable row level security;
alter table public.tempering_batch_items enable row level security;
