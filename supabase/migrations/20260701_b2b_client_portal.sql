-- Кабинет B2B-партнёра — фундамент (первый срез).
-- Привязка карточки клиента (b2b_clients) к учётной записи auth.users, чтобы
-- партнёр, войдя под своим логином, видел ТОЛЬКО свои заказы.
--
-- Аддитивно и идемпотентно. Применяется вручную через Supabase SQL Editor
-- (в проекте нет авто-раннера миграций). Код кабинета работает и до применения:
-- при отсутствии колонки API отдаёт пустой список (партнёр «не привязан»).
--
-- Доступ партнёра НИКОМУ не выдаётся этой миграцией — нужно отдельно:
--   1) применить эту миграцию;
--   2) завести партнёру учётку (auth) и роль 'partner' в public.users;
--   3) проставить b2b_clients.user_id = <id учётки> нужному клиенту.
-- Всё это — решение владельца (внешний доступ), поэтому делается вручную.

ALTER TABLE public.b2b_clients
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_b2b_clients_user_id
  ON public.b2b_clients (user_id)
  WHERE user_id IS NOT NULL;

COMMENT ON COLUMN public.b2b_clients.user_id IS
  'Учётка партнёра (auth.users). Заполняется вручную владельцем при выдаче доступа в кабинет /partner. Scoping заказов партнёра идёт по этому полю.';
