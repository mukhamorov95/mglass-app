-- ──────────────────────────────────────────────────
-- Справочник: бюджетные душевые (готовые модели)
-- ──────────────────────────────────────────────────
create table if not exists public.shower_budget_models (
  id               bigserial primary key,
  name             text      not null,
  shower_type      text      not null default 'stationary', -- stationary / swing / sliding
  supplier         text,
  manufacturer     text,
  color            text,
  website_price    numeric   not null default 0,
  discount_percent numeric   not null default 0,
  cost_price       numeric   not null default 0,
  has_vat          boolean   not null default false,
  kit_composition  text,
  photo_url        text,
  comment          text,
  active           boolean   not null default true,
  created_at       timestamptz not null default now()
);

-- ──────────────────────────────────────────────────
-- Справочник: стандартная фурнитура по категориям
-- ──────────────────────────────────────────────────
create table if not exists public.shower_standard_hardware (
  id               bigserial primary key,
  name             text      not null,
  category         text      not null, -- петли / ручки / профили / крепления / штанги / комплектующие / уплотнители / доп
  shower_type      text      not null default 'universal', -- stationary / swing / sliding / universal
  supplier         text,
  manufacturer     text,
  colors           text[]    not null default '{}',
  website_price    numeric   not null default 0,
  discount_percent numeric   not null default 0,
  cost_price       numeric   not null default 0,
  has_vat          boolean   not null default false,
  unit             text      not null default 'шт',        -- шт / м.п. / компл.
  photo_url        text,
  description      text,
  compatible_with  bigint[]  not null default '{}',        -- id совместимых позиций
  active           boolean   not null default true,
  created_at       timestamptz not null default now()
);
