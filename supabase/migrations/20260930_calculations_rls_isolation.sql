-- Расчёты: менеджер видит и правит только свои (правило 4 SYSTEM.md / PROJECT_RULES.md).
--
-- Было: две разрешающие SELECT-политики складывались через OR, и
-- `auth_select_calculations` (NOT is_partner()) открывала все расчёты — с именами,
-- телефонами и ценами клиентов — любому сотруднику: цеху, бухгалтерии, закупке,
-- менеджеру без флагов. UPDATE так же: `auth_update_calculations` давал любому
-- сотруднику правку любого чужого расчёта.
--
-- Кто видит все расчёты (sees_all_calculations):
--   admin, ceo            — владелец;
--   cfo                   — /cfo/margins, /cfo/unit, /admin/dashboard читают расчёты под RLS;
--   commercial            — видит все сделки B2C (lib/b2c/dealScope.ts), /admin/health-check;
--   can_view_all_deals    — «Все сделки» в /admin/users: /calculations, /api/search;
--   can_view_all_clients  — «Все клиенты»: /clients, /clients/[phone] и «Висящие расчёты»
--                           в /my-day (оттуда ссылка на /calculations/[id] чужого расчёта).
-- Два флага — два определения «видит чужие сделки» в коде; пока их не свели в одно,
-- политика пускает по любому, иначе /clients и /my-day молча пустеют у тех, кому
-- владелец эти галки включил.
--
-- Правка чужого расчёта — только владелец (admin/ceo), как в PATCH /api/calculations/save.
-- DELETE (свои или admin) не меняется. INSERT-политики нет и не было: запись идёт
-- через /api/calculations/save (service-role, проверка роли и инвариантов расчёта).
--
-- Проба 30.09.2026 в откатываемой подтранзакции, 101 расчёт:
--   admin 101 · Дмитрий (all_clients) 101 · Вера (оба флага) 101 · cfo/commercial 101
--   Яна (без флагов) 101 → 9 (свои) · Никита (цех) 101 → 0 · Алёна (бухгалтерия) 101 → 0
--   partner 0 · anon 0; UPDATE чужого расчёта: было — любой сотрудник, стало — только admin.

create or replace function public.sees_all_calculations()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users u
    where u.id = auth.uid()
      and (u.role in ('admin', 'ceo', 'commercial', 'cfo')
           or u.can_view_all_deals is true
           or u.can_view_all_clients is true)
  )
$$;

revoke all on function public.sees_all_calculations() from public, anon;
grant execute on function public.sees_all_calculations() to authenticated, service_role;

drop policy if exists auth_select_calculations on public.calculations;
drop policy if exists calc_select on public.calculations;
drop policy if exists auth_update_calculations on public.calculations;
drop policy if exists calc_update on public.calculations;

create policy calc_select on public.calculations
  for select to authenticated
  using (created_by = (select auth.uid()) or public.sees_all_calculations());

create policy calc_update on public.calculations
  for update to authenticated
  using (created_by = (select auth.uid()) or public.is_owner())
  with check (created_by = (select auth.uid()) or public.is_owner());
