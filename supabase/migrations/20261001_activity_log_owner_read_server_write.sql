-- Журнал действий activity_log: кто менял права, пароль, реквизиты покупателя.
-- Было (живая база 01.10.2026): RLS включён без единой политики, а у anon и
-- authenticated — полный набор грантов. Итог:
--   • запись из lib/activityLog.ts шла ключом пользователя и отбивалась RLS (42501),
--     ошибку никто не читал — 0 строк при сиквенсе 171: журнал не вёлся никогда;
--   • экран /admin/activity-log (только admin/ceo) всегда показывал пусто;
--   • ворота на запись держал один RLS: добавь кто-нибудь политику пошире — и любой,
--     даже без входа, пишет и правит журнал от чужого имени (user_id/user_name — свободные поля).
-- Стало: пишет только сервер (service-role после проверки сессии в lib/activityLog.ts,
-- автор берётся из сессии, а не из аргумента), читает только владелец. Журнал
-- дописывается и не правится: UPDATE/DELETE/TRUNCATE не выдан никому, включая service_role.

revoke all on table public.activity_log from anon;
revoke insert, update, delete, truncate, references, trigger on table public.activity_log from authenticated;
grant select on table public.activity_log to authenticated;
revoke update, delete, truncate on table public.activity_log from service_role;
revoke all on sequence public.activity_log_id_seq from anon, authenticated;

drop policy if exists activity_log_owner_read on public.activity_log;
create policy activity_log_owner_read on public.activity_log
  for select to authenticated using (public.is_owner());
