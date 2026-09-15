-- Остатки листа (маршрут docs/UNIT_ECONOMICS_ROUTE.md, этап Э6.3).
-- Правило владельца 15.09: остаток листа — не отход, а приход на стеллаж под следующие
-- заказы. Остаток — кусок от 400×800 мм; меньше — полоса в отход. Записывает мастер резки:
-- «взял лист → нарезал → закрыл лист → записал остаток». Срок хранения пока не задаётся.

alter table public.cutting_settings add column if not exists min_remnant_short integer not null default 400;
alter table public.cutting_settings add column if not exists min_remnant_long  integer not null default 800;

-- Журнал листов: что взяли в резку (новый лист или остаток) и когда.
create table if not exists public.sheet_cuts (
  id              bigserial primary key,
  material_id     integer references public.b2b_materials(id),
  material_name   text not null,
  thickness       numeric not null,
  source          text not null check (source in ('sheet', 'remnant')),
  sheet_w         integer not null check (sheet_w > 0),
  sheet_h         integer not null check (sheet_h > 0),
  remnant_id      bigint,
  order_ids       integer[] not null default '{}',
  note            text,
  created_by      uuid,
  created_by_name text,
  created_at      timestamptz not null default now()
);

-- Остатки на стеллаже. Код «ОС-12» пишут маркером на стекле.
create table if not exists public.sheet_remnants (
  id              bigserial primary key,
  code            text generated always as ('ОС-' || id::text) stored,
  material_id     integer references public.b2b_materials(id),
  material_name   text not null,
  thickness       numeric not null,
  width_mm        integer not null check (width_mm > 0),
  height_mm       integer not null check (height_mm > 0),
  location        text,
  status          text not null default 'in_stock' check (status in ('in_stock', 'used', 'scrapped')),
  from_cut_id     bigint references public.sheet_cuts(id),
  used_cut_id     bigint references public.sheet_cuts(id),
  note            text,
  created_by      uuid,
  created_by_name text,
  created_at      timestamptz not null default now(),
  closed_by_name  text,
  closed_at       timestamptz
);

do $$ begin
  alter table public.sheet_cuts add constraint sheet_cuts_remnant_fk foreign key (remnant_id) references public.sheet_remnants(id);
exception when duplicate_object then null; end $$;

create index if not exists sheet_remnants_stock_idx on public.sheet_remnants (material_name, thickness, status);
create index if not exists sheet_cuts_created_idx on public.sheet_cuts (created_at);

-- Доступ только через /api/production/remnants: сервисный клиент после проверки роли
-- (lib/inventory/auth: пишут владелец, снабжение, производство). Политик для anon и
-- authenticated нет сознательно — прямой запрос из браузера получит пусто, не данные.
alter table public.sheet_cuts enable row level security;
alter table public.sheet_remnants enable row level security;
revoke all on public.sheet_cuts, public.sheet_remnants from anon, authenticated;
