-- =============================================
-- MGlass App — схема базы данных
-- Выполнять в Supabase SQL Editor
-- =============================================

-- Пользователи (расширяет auth.users)
create table public.users (
  id uuid references auth.users(id) on delete cascade primary key,
  name text not null,
  email text not null,
  role text not null default 'manager' check (role in ('admin', 'manager')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Материалы (главный справочник)
create table public.materials (
  id bigint generated always as identity primary key,
  name text not null,
  category text not null,
  unit text not null,
  cost_price numeric(12,2) not null,
  sale_price numeric(12,2),            -- расчётная цена для калькуляторов (зеркала: отличается от закупки)
  has_vat boolean not null default false,
  vat_rate numeric(5,2) not null default 20,
  active boolean not null default true,
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Услуги (монтаж, доставка)
create table public.services (
  id bigint generated always as identity primary key,
  name text not null,
  unit text not null,
  cost_price numeric(12,2) not null,
  sale_price numeric(12,2),
  active boolean not null default true,
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Фурнитура
create table public.hardware_items (
  id bigint generated always as identity primary key,
  name text not null,
  system_type text not null check (system_type in ('sliding', 'swing', 'universal')),
  unit text not null,
  cost_price numeric(12,2) not null,
  active boolean not null default true,
  comment text,
  created_at timestamptz not null default now()
);

-- Финансовые настройки (одна строка)
create table public.financial_settings (
  id bigint generated always as identity primary key,
  tax_percent numeric(5,2) not null default 12,
  manager_percent numeric(5,2) not null default 3,
  realization_percent numeric(5,2) not null default 3,
  marketing_percent numeric(5,2) not null default 5,
  transport_percent numeric(5,2) not null default 2,
  operation_percent numeric(5,2) not null default 12,
  default_margin numeric(5,2) not null default 40,
  min_margin numeric(5,2) not null default 25,
  updated_at timestamptz not null default now()
);

-- Типы партнёрок
create table public.partner_types (
  id bigint generated always as identity primary key,
  name text not null,
  percent numeric(5,2) not null default 0,
  active boolean not null default true
);

-- Коэффициенты и надбавки
create table public.coefficients (
  id bigint generated always as identity primary key,
  name text not null,
  product_type text,
  condition_type text,
  condition_value numeric(12,2),
  effect_type text not null check (effect_type in ('multiplier', 'fixed_add')),
  effect_value numeric(12,2) not null,
  active boolean not null default true
);

-- История расчётов
create table public.calculations (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id),
  product_type text not null,
  input_data jsonb not null,
  cost_breakdown jsonb not null,
  financial_breakdown jsonb not null,
  base_price numeric(12,2) not null,
  discount numeric(5,2) not null default 0,
  partner_percent numeric(5,2) not null default 0,
  final_price numeric(12,2) not null,
  margin numeric(5,2) not null,
  profit numeric(12,2) not null,
  status text not null default 'draft' check (status in ('draft', 'sent', 'approved', 'rejected')),
  manager_bonus numeric(12,2) not null default 0,
  client_text text,
  notes text
);

-- =============================================
-- RLS (Row Level Security)
-- =============================================

alter table public.users enable row level security;
alter table public.materials enable row level security;
alter table public.services enable row level security;
alter table public.hardware_items enable row level security;
alter table public.financial_settings enable row level security;
alter table public.partner_types enable row level security;
alter table public.coefficients enable row level security;
alter table public.calculations enable row level security;

-- Справочники читают все авторизованные
create policy "Авторизованные читают материалы"
  on public.materials for select to authenticated using (true);

create policy "Авторизованные читают услуги"
  on public.services for select to authenticated using (true);

create policy "Авторизованные читают фурнитуру"
  on public.hardware_items for select to authenticated using (true);

create policy "Авторизованные читают партнёрки"
  on public.partner_types for select to authenticated using (true);

create policy "Авторизованные читают коэффициенты"
  on public.coefficients for select to authenticated using (true);

create policy "Авторизованные читают фин.настройки"
  on public.financial_settings for select to authenticated using (true);

-- Расчёты: менеджер видит свои, админ — все
create policy "Менеджер видит свои расчёты"
  on public.calculations for select to authenticated
  using (created_by = auth.uid());

create policy "Менеджер создаёт расчёты"
  on public.calculations for insert to authenticated
  with check (created_by = auth.uid());

-- =============================================
-- Триггер updated_at
-- =============================================

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger materials_updated_at
  before update on public.materials
  for each row execute function update_updated_at();

create trigger services_updated_at
  before update on public.services
  for each row execute function update_updated_at();
