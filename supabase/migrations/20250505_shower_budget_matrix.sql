-- ──────────────────────────────────────────────────────────────────
-- Матрица бюджетной фурнитуры душевых: типы × поставщики × цвета
-- ──────────────────────────────────────────────────────────────────

-- Справочник цветов (динамические колонки)
create table if not exists public.shower_hw_colors (
  id         serial primary key,
  name       text    not null unique,
  sort_order int     not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Справочник поставщиков
create table if not exists public.shower_hw_suppliers (
  id         serial primary key,
  name       text    not null unique,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Справочник типов фурнитуры (П-ПРОФИЛЬ, ШТАНГА, ПЕТЛИ, ...)
create table if not exists public.shower_hw_types (
  id           serial primary key,
  name         text    not null unique,
  unit         text    not null default 'шт',   -- шт / м.п. / хлыст
  whip_length  int,                              -- мм, если unit = 'хлыст'
  sort_order   int     not null default 0,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- Строки матрицы: модель × тип × поставщик
create table if not exists public.shower_budget_hw_rows (
  id          serial primary key,
  model_id    text not null,           -- M1..M12
  hw_type_id  int  not null references public.shower_hw_types(id)     on delete cascade,
  supplier_id int  not null references public.shower_hw_suppliers(id)  on delete cascade,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now(),
  unique (model_id, hw_type_id, supplier_id)
);

-- Цены: строка × цвет
create table if not exists public.shower_budget_prices (
  id          serial primary key,
  row_id      int     not null references public.shower_budget_hw_rows(id) on delete cascade,
  color_id    int     not null references public.shower_hw_colors(id)       on delete cascade,
  price       numeric not null default 0,
  discount    numeric,
  final_price numeric,
  updated_at  timestamptz not null default now(),
  unique (row_id, color_id)
);

-- Начальный набор цветов
insert into public.shower_hw_colors (name, sort_order) values
  ('ХРОМ',            1),
  ('ХРОМ МАТОВЫЙ',    2),
  ('ЧЕРНЫЙ МАТОВЫЙ',  3),
  ('БРОНЗА',          4),
  ('БЕЛЫЙ',           5),
  ('ЗОЛОТОЙ',         6),
  ('МАТОВОЕ ЗОЛОТО',  7),
  ('ОРУЖЕЙНАЯ СТАЛЬ', 8)
on conflict (name) do nothing;
