-- ============================================================================
-- Кабинет B2B-заказчика — РУБЕЖ 2: RLS-бэкстоп изоляции партнёра (deny-by-default).
--
-- ПРОБЛЕМА, которую закрываем:
--   На b2b_clients / b2b_orders висит политика "auth" = FOR ALL USING(auth.role()='authenticated'),
--   а на b2b_materials/b2b_services/b2b_surcharge_rules/attachments — USING(true).
--   То есть ЛЮБОЙ залогиненный пользователь (в т.ч. партнёр) при прямом обращении к БД
--   через anon-ключ видит ВСЕ заказы всех клиентов, чужие чертежи и НАШУ себестоимость.
--   Сейчас партнёр не видит этого лишь потому, что UI ходит только через /api/partner/*
--   (service-role + фильтр по user_id). Это Рубеж 1. Здесь добавляем Рубеж 2 — базу.
--
-- РЕШЕНИЕ (аддитивно, безопасно для внутренних):
--   Хелпер public.is_partner() → true только для роли 'partner'.
--   К каждой широкой политике добавляем "AND NOT public.is_partner()".
--   Для НЕ-партнёра выражение всегда TRUE → поведение внутренних пользователей
--   не меняется НИ на байт. Партнёру остаются только явные политики «своё»:
--   "Partner reads own client" / "Partner reads own orders" / own attachments.
--
-- ПРИМЕНЕНИЕ: вручную в Supabase SQL Editor (в проекте нет авто-раннера миграций).
--   Идемпотентно (drop policy if exists → create). Применять целиком одной транзакцией.
--
-- ПРОВЕРКА после применения (см. блок в конце файла).
--
-- ⚠️ ОТДЕЛЬНО (НЕ здесь): таблицы materials/services/financial_settings/coefficients
--   имеют политики для роли anon/public с USING(true) — наша себестоимость/маржа
--   ретейла читаема даже анонимно. Это системная дыра шире партнёров; трогать её надо
--   отдельно, проверив зависимости публичного сайта/ретейл-калькулятора. Вынесено в отдельную задачу.
-- ============================================================================

begin;

-- 0) Хелпер: текущий пользователь — партнёр?
create or replace function public.is_partner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and role = 'partner'
  );
$$;
revoke all on function public.is_partner() from public;
grant execute on function public.is_partner() to authenticated;

comment on function public.is_partner() is
  'true, если текущий auth.uid() имеет роль partner (public.users.role). Для RLS-бэкстопа кабинета заказчика.';

-- ── b2b_clients ─────────────────────────────────────────────────────────────
drop policy if exists "auth" on public.b2b_clients;
create policy "auth" on public.b2b_clients for all to public
  using  (auth.role() = 'authenticated' and not public.is_partner())
  with check (auth.role() = 'authenticated' and not public.is_partner());

drop policy if exists "Org tenant b2b_clients" on public.b2b_clients;
create policy "Org tenant b2b_clients" on public.b2b_clients for all to authenticated
  using  (organization_id = current_org_id() and not public.is_partner())
  with check (organization_id = current_org_id() and not public.is_partner());
-- "Partner reads own client" (SELECT user_id=auth.uid()) — НЕ трогаем, это дверь партнёра.

-- ── b2b_orders ──────────────────────────────────────────────────────────────
drop policy if exists "auth" on public.b2b_orders;
create policy "auth" on public.b2b_orders for all to public
  using  (auth.role() = 'authenticated' and not public.is_partner())
  with check (auth.role() = 'authenticated' and not public.is_partner());

drop policy if exists "Org tenant b2b_orders" on public.b2b_orders;
create policy "Org tenant b2b_orders" on public.b2b_orders for all to authenticated
  using  (organization_id = current_org_id() and not public.is_partner())
  with check (organization_id = current_org_id() and not public.is_partner());
-- "Partner reads own orders" (SELECT client_id ∈ свои) — НЕ трогаем.

-- ── b2b_calculation_attachments (чужие чертежи) ─────────────────────────────
drop policy if exists "Authenticated users manage b2b attachments" on public.b2b_calculation_attachments;
create policy "Authenticated users manage b2b attachments" on public.b2b_calculation_attachments for all to authenticated
  using  (not public.is_partner())
  with check (not public.is_partner());

drop policy if exists "Partner reads own attachments" on public.b2b_calculation_attachments;
create policy "Partner reads own attachments" on public.b2b_calculation_attachments for select to authenticated
  using (order_id in (
    select o.id from public.b2b_orders o
    join public.b2b_clients c on c.id = o.client_id
    where c.user_id = auth.uid()
  ));

-- ── b2b_materials (наша себестоимость cost_price) ───────────────────────────
drop policy if exists "auth" on public.b2b_materials;
create policy "auth" on public.b2b_materials for all to public
  using  (auth.role() = 'authenticated' and not public.is_partner())
  with check (auth.role() = 'authenticated' and not public.is_partner());

-- ── b2b_services (cost_price, тайминги) ─────────────────────────────────────
drop policy if exists "auth_all" on public.b2b_services;
create policy "auth_all" on public.b2b_services for all to authenticated
  using  (not public.is_partner())
  with check (not public.is_partner());
drop policy if exists "auth_read" on public.b2b_services;
create policy "auth_read" on public.b2b_services for select to authenticated
  using (not public.is_partner());

-- ── b2b_surcharge_rules (внутренние надбавки) ───────────────────────────────
drop policy if exists "auth_all" on public.b2b_surcharge_rules;
create policy "auth_all" on public.b2b_surcharge_rules for all to authenticated
  using  (not public.is_partner())
  with check (not public.is_partner());
drop policy if exists "auth_read" on public.b2b_surcharge_rules;
create policy "auth_read" on public.b2b_surcharge_rules for select to authenticated
  using (not public.is_partner());

-- ── b2b_interactions (CRM-заметки по клиентам) ──────────────────────────────
drop policy if exists "Org tenant b2b_interactions" on public.b2b_interactions;
create policy "Org tenant b2b_interactions" on public.b2b_interactions for all to authenticated
  using  (organization_id = current_org_id() and not public.is_partner())
  with check (organization_id = current_org_id() and not public.is_partner());

-- ── b2b_leads / activities / outreach (продажи, внутреннее) ─────────────────
drop policy if exists "Org tenant b2b_leads" on public.b2b_leads;
create policy "Org tenant b2b_leads" on public.b2b_leads for all to authenticated
  using  (organization_id = current_org_id() and not public.is_partner())
  with check (organization_id = current_org_id() and not public.is_partner());
drop policy if exists "rls_b2b_leads" on public.b2b_leads;
create policy "rls_b2b_leads" on public.b2b_leads for all to public
  using  (auth.uid() is not null and not public.is_partner())
  with check (auth.uid() is not null and not public.is_partner());

drop policy if exists "rls_b2b_activities" on public.b2b_lead_activities;
create policy "rls_b2b_activities" on public.b2b_lead_activities for all to public
  using  (auth.uid() is not null and not public.is_partner())
  with check (auth.uid() is not null and not public.is_partner());

drop policy if exists "Org tenant b2b_outreach_templates" on public.b2b_outreach_templates;
create policy "Org tenant b2b_outreach_templates" on public.b2b_outreach_templates for all to authenticated
  using  (organization_id = current_org_id() and not public.is_partner())
  with check (organization_id = current_org_id() and not public.is_partner());
drop policy if exists "rls_b2b_outreach" on public.b2b_outreach_templates;
create policy "rls_b2b_outreach" on public.b2b_outreach_templates for all to public
  using  (auth.uid() is not null and not public.is_partner())
  with check (auth.uid() is not null and not public.is_partner());

-- ── b2b_growth_items (внутренняя стратегия) ─────────────────────────────────
drop policy if exists "b2b_growth_write" on public.b2b_growth_items;
create policy "b2b_growth_write" on public.b2b_growth_items for all to authenticated
  using  (not public.is_partner())
  with check (not public.is_partner());
drop policy if exists "b2b_growth_read" on public.b2b_growth_items;
create policy "b2b_growth_read" on public.b2b_growth_items for select to authenticated
  using (not public.is_partner());

-- ── b2b_films (каталог плёнок) ──────────────────────────────────────────────
drop policy if exists "Auth manage b2b_films" on public.b2b_films;
create policy "Auth manage b2b_films" on public.b2b_films for all to authenticated
  using  (not public.is_partner())
  with check (not public.is_partner());
drop policy if exists "Auth read b2b_films" on public.b2b_films;
create policy "Auth read b2b_films" on public.b2b_films for select to authenticated
  using (not public.is_partner());

commit;

-- ============================================================================
-- ПРОВЕРКА (выполнять от имени тестовой учётки партнёра, НЕ service-role):
--   -- как партнёр (через приложение/impersonation), в SQL с jwt claim sub = <partner uid>:
--   select count(*) from b2b_orders;      -- ожидаем: только свои (client_id партнёра)
--   select count(*) from b2b_clients;     -- ожидаем: 1 (своя карточка)
--   select count(*) from b2b_materials;   -- ожидаем: 0 (нет доступа к себестоимости)
--   select count(*) from b2b_calculation_attachments; -- ожидаем: только по своим заказам
--
-- Внутренний пользователь (manager/admin) — всё как было (NOT is_partner() = true).
-- Откат: заменить каждую политику её версией без "and not public.is_partner()".
-- ============================================================================
