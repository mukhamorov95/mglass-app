-- ============================================================================
-- КП: строгая изоляция по менеджеру + удаление только owner-ролями (admin/ceo).
-- Менеджер видит ТОЛЬКО свои КП (без see_all_orders/commercial). Удалять КП
-- может только admin/ceo. Аддитивно/идемпотентно.
-- ============================================================================

-- Чтение: свои ИЛИ owner-роли (admin/ceo). Убрали see_all_orders и commercial.
DROP POLICY IF EXISTS "cp read own or all" ON public.commercial_proposals;
CREATE POLICY "cp read own or all" ON public.commercial_proposals
  FOR SELECT TO authenticated USING (
    manager_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin','ceo'))
  );

-- Удаление: только admin/ceo (защита в глубину; API тоже проверяет роль).
DROP POLICY IF EXISTS "cp delete owner only" ON public.commercial_proposals;
CREATE POLICY "cp delete owner only" ON public.commercial_proposals
  FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role IN ('admin','ceo'))
  );
