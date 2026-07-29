-- RLS, волна 2: ПРАЙСЫ И СПРАВОЧНИКИ.
--
-- Эти таблицы читает браузер (калькуляторы — клиентские компоненты), поэтому
-- слепое включение оставило бы всю компанию без цен. Даём чтение всем
-- авторизованным, запись — только владельцу/админу/коммерческому/CFO.
--
-- МИНА, которую здесь обезвредили: у glass_price_matrix уже лежала политика
-- «Org tenant glass_price_matrix» с cmd = ALL. При выключенном RLS она не
-- работала, но в момент включения выдала бы КАЖДОМУ авторизованному —
-- включая мастеров цеха — право переписывать матрицу цен. Сужена до SELECT.
--
-- Вторая мина (в коде, не здесь): калькуляторы душевой и лофта использовали
-- устаревший lib/supabase.ts с сессией в localStorage, тогда как приложение
-- логинится в куки. Они ходили как anon и после закрытия остались бы без
-- прайса — переведены на @/lib/supabase-browser тем же коммитом.
--
-- Проверено публичным ключом до/после: 32/543/60/3/6 строк → 0.
-- Проверено под логином: матрица цен и калькулятор B2B работают.

create or replace function public.can_edit_pricing() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.users u where u.id = auth.uid()
                 and u.role in ('admin','ceo','commercial','cfo'))
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'glass_price_matrix','facet_prices','material_waste_modifiers',
    'shower_catalog_items','shower_catalog_prices','shower_hardware_kits',
    'shower_hw_colors','shower_hw_suppliers','shower_hw_types',
    'shower_budget_models','shower_budget_prices','shower_budget_kit_rows',
    'shower_budget_hw_rows','shower_budget_manual_prices','shower_standard_hardware'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "Org tenant %I" on public.%I', t, t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    -- Себестоимость внутри компании не секрет; секрет — возможность её переписать.
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.can_edit_pricing())', t || '_write', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.can_edit_pricing()) with check (public.can_edit_pricing())', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.can_edit_pricing())', t || '_delete', t);
  end loop;
end $$;
