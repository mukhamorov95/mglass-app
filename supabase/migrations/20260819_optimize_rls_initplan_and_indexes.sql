-- Оптимизация Supabase по данным advisors (performance). Только производительность,
-- семантика доступа НЕ меняется.
--
-- 1) auth_rls_initplan (54 политики): обернуть auth.uid()/auth.role()/auth.jwt() в
--    (select ...), чтобы Postgres вычислял их ОДИН раз (initplan), а не на каждую
--    строку скана. Рекомендация самого Supabase-линтера, приём семантически
--    эквивалентен. Правим ТОЛЬКО auth.*-вызовы; ALTER POLICY сохраняет роли/cmd/
--    permissive; всё остальное выражение — байт-в-байт. WHERE исключает уже
--    обёрнутые политики, поэтому миграция идемпотентна.
DO $$
DECLARE r record; u text; w text;
BEGIN
  FOR r IN
    SELECT tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (qual ~ 'auth\.(uid|role|jwt)\(\)' OR with_check ~ 'auth\.(uid|role|jwt)\(\)')
      AND NOT (coalesce(qual, '') ~ '\(\s*select\s+auth\.' OR coalesce(with_check, '') ~ '\(\s*select\s+auth\.')
  LOOP
    u := regexp_replace(regexp_replace(regexp_replace(r.qual,
           'auth\.uid\(\)', '(select auth.uid())', 'g'),
           'auth\.role\(\)', '(select auth.role())', 'g'),
           'auth\.jwt\(\)', '(select auth.jwt())', 'g');
    w := regexp_replace(regexp_replace(regexp_replace(r.with_check,
           'auth\.uid\(\)', '(select auth.uid())', 'g'),
           'auth\.role\(\)', '(select auth.role())', 'g'),
           'auth\.jwt\(\)', '(select auth.jwt())', 'g');
    EXECUTE 'ALTER POLICY ' || quote_ident(r.policyname) || ' ON public.' || quote_ident(r.tablename)
      || CASE WHEN r.qual       IS NOT NULL THEN ' USING (' || u || ')' ELSE '' END
      || CASE WHEN r.with_check IS NOT NULL THEN ' WITH CHECK (' || w || ')' ELSE '' END;
  END LOOP;
END $$;

-- 2) duplicate_index: два байт-идентичных partial-индекса на production_tasks —
--    оставляем pt_active_problems_idx, дубль убираем.
DROP INDEX IF EXISTS public.pt_open_problems;

-- 3) Индексы на реально джойнящиеся/фильтруемые FK. Аудит-колонки
--    (created_by/author_id/supplier_id/voided_by/…) НЕ индексируем намеренно —
--    по ним почти не фильтруют, а лишний индекс тормозит запись.
CREATE INDEX IF NOT EXISTS idx_order_lines_calculation_id           ON public.order_lines(calculation_id);
CREATE INDEX IF NOT EXISTS idx_crm_sales_calculation_id             ON public.crm_sales(calculation_id);
CREATE INDEX IF NOT EXISTS idx_measurements_order_id                ON public.measurements(order_id);
CREATE INDEX IF NOT EXISTS idx_delivery_shipment_orders_order_id    ON public.delivery_shipment_orders(order_id);
CREATE INDEX IF NOT EXISTS idx_contracts_kp_id                      ON public.contracts(kp_id);
CREATE INDEX IF NOT EXISTS idx_calculations_parent_calc_id          ON public.calculations(parent_calc_id);
CREATE INDEX IF NOT EXISTS idx_b2b_clients_manager_id               ON public.b2b_clients(manager_id);
CREATE INDEX IF NOT EXISTS idx_measure_requests_manager_id          ON public.measure_requests(manager_id);
CREATE INDEX IF NOT EXISTS idx_b2b_client_manager_history_client_id ON public.b2b_client_manager_history(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_payer_entity_id             ON public.invoices(payer_entity_id);
CREATE INDEX IF NOT EXISTS idx_payment_requests_entry_id            ON public.payment_requests(entry_id);
CREATE INDEX IF NOT EXISTS idx_role_assignments_role_id             ON public.role_assignments(role_id);
