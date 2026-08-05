-- Харденинг SECURITY DEFINER функций (Supabase advisors 0028 anon_security_definer, 0011 search_path).
-- Аноним не должен вызывать пишущие RPC; триггер-функции не должны торчать в REST; пин search_path.

-- 1) Пишущие RPC — закрыть анониму (аноним не должен менять заказы). authenticated оставляем — им пользуется прод.
REVOKE EXECUTE ON FUNCTION public.mark_detail_stages(bigint, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.patch_order_notes_shallow(bigint, jsonb) FROM anon;

-- 2) Триггер-функции не должны вызываться через REST RPC (триггерам гранты ролей не нужны).
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_order_number() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_order_number() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.assign_order_number() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM anon, authenticated;

-- 3) Пин search_path у функций с mutable search_path (хардненинг от подмены схемы).
ALTER FUNCTION public.current_org_id() SET search_path = public;
ALTER FUNCTION public.set_order_number() SET search_path = public;
ALTER FUNCTION public.generate_order_number() SET search_path = public;
ALTER FUNCTION public.assign_order_number() SET search_path = public;
ALTER FUNCTION public.update_updated_at_column() SET search_path = public;
ALTER FUNCTION public.next_cp_number() SET search_path = public;
ALTER FUNCTION public.next_contract_number() SET search_path = public;
ALTER FUNCTION public.recalc_supplier_prices() SET search_path = public;
