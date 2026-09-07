-- Расчёт больше не пишется в базу прямо из браузера.
--
-- Было: две permissive-политики на INSERT (auth_insert_calculations, calc_insert),
-- и любая вкладка могла записать расчёт мимо правил — они жили в интерфейсе.
-- Расчёт №134 так и сохранился без клиента через пять часов после выката правки:
-- страница была открыта до неё.
--
-- Стало: INSERT только через POST /api/calculations/save (service-role, обходит RLS),
-- где проверяются роль, авторство и инварианты (lib/calcInvariants.ts).
-- SELECT/UPDATE/DELETE не трогаем — ими пользуются экраны истории расчётов.

drop policy if exists auth_insert_calculations on public.calculations;
drop policy if exists calc_insert on public.calculations;

comment on table public.calculations is
  'Расчёты. INSERT — только через /api/calculations/save (service-role): там инварианты и автор из сессии. Прямая вставка из браузера запрещена намеренно.';
