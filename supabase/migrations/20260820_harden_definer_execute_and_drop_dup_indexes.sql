-- Прод-гигиена БД, 2-я волна.
--
-- 1) БЕЗОПАСНОСТЬ (реальная дыра): мутирующие SECURITY DEFINER-функции были
--    EXECUTE для PUBLIC, т.е. и для anon. Их внутренний гард _assert_shop_caller()
--    начинается с `if auth.uid() is null then return` (задумано под service-key,
--    авторизация на уровне роута), но у АНОНИМА uid тоже NULL → гард его пропускал.
--    Итог: неавторизованный запрос через публичный anon-ключ к
--    /rest/v1/rpc/patch_order_notes_shallow или /mark_detail_stages мог менять
--    notes/стадии ЛЮБОГО заказа (notes хранят статус оплаты, стадии, urgent).
--    Легитимные вызовы: authenticated (браузер производственника,
--    app/production-app/orders/[id]) + service_role (API-роуты sync-stages,
--    production-tasks; воркер owner-tasks). anon не нужен ни одной функции.
--    Убираем PUBLIC-грант, выдаём EXECUTE только нужным ролям.
revoke execute on function public.mark_detail_stages(bigint, jsonb) from public;
grant  execute on function public.mark_detail_stages(bigint, jsonb) to authenticated, service_role;

revoke execute on function public.patch_order_notes_shallow(bigint, jsonb) from public;
grant  execute on function public.patch_order_notes_shallow(bigint, jsonb) to authenticated, service_role;

-- Очередь задач владельца — только воркер под service_role.
revoke execute on function public.claim_next_owner_task(text) from public;
grant  execute on function public.claim_next_owner_task(text) to service_role;

-- Триггер-функция, не для прямого RPC-вызова (триггер выполняется как владелец,
-- отдельный грант не нужен).
revoke execute on function public.handle_new_user() from public;

-- 2) Дубликаты индексов: в каждой паре есть UNIQUE-constraint (*_key) и избыточная
--    его копия (обычный idx_* на тех же колонках). Уникальный оставляем, дубль
--    убираем (ускоряет запись, экономит место; на чтение не влияет).
drop index if exists public.idx_client_ownership_phone;             -- дубль client_ownership_phone_key
drop index if exists public.idx_ext_conv_chat_id;                   -- дубль external_conversations_source_external_chat_id_key
drop index if exists public.idx_pricing_model_config_v2_category;   -- дубль pricing_model_config_v2_product_category_key
