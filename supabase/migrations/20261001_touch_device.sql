-- У10: отметка «устройство живо». Политик UPDATE на user_devices нет (есть только
-- select_own), поэтому из браузера строку обновить нельзя — запрос молча менял 0
-- строк, и last_seen_at обновлялся позже регистрации лишь у 10 записей из 48.
-- Отметку делает функция владельца строки.

create or replace function public.touch_device(p_device_id text)
returns void
language sql
security definer
set search_path = public
as $$
  update user_devices
     set last_seen_at = now()
   where user_id = auth.uid()
     and device_id = p_device_id
     and revoked_at is null;
$$;

revoke all on function public.touch_device(text) from public, anon;
grant execute on function public.touch_device(text) to authenticated;
