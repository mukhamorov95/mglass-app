-- Закрыть REST-экспозицию RLS-хелперов для анонима (advisor 0028).
-- Проверено: эти функции используются в RLS-политиках ТОЛЬКО для роли authenticated
-- (ни одной политики для anon), поэтому отзыв anon безопасен и не ломает RLS.
-- authenticated НЕ трогаем — им политики и пользуются.
revoke execute on function public.is_admin() from anon;
revoke execute on function public.can_edit_pricing() from anon;
revoke execute on function public.current_org_id() from anon;
revoke execute on function public.crm_caller() from anon;
revoke execute on function public._assert_shop_caller() from anon;
