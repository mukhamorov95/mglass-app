-- mark_order_stages (20260830) создавалась без REVOKE, из-за чего EXECUTE достался
-- PUBLIC и anon — в отличие от mark_detail_stages / patch_order_notes_shallow.
--
-- Почему это важно: гард внутри функции пропускает проверку роли при
-- auth.uid() IS NULL (расчёт на сервис-ключ, который проверяет права в роуте).
-- Но у анонимного вызова auth.uid() тоже NULL. Значит с публичным anon-ключом
-- (он по определению лежит в браузере) можно было вызвать RPC напрямую и
-- переписать notes.stages ЛЮБОГО заказа — отметить отгрузку, снять оплату.
--
-- Приводим права к тому же виду, что у остальных definer-функций контура.
REVOKE ALL ON FUNCTION public.mark_order_stages(bigint, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_order_stages(bigint, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_order_stages(bigint, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_order_stages(bigint, jsonb) TO service_role;
