-- Контур замеров: заявка менеджера (голос/текст → AI-структура) → замерщик
-- назначает дату/время → календарь занятости для всех → замер выполнен/сложность
-- → учёт денег замерщика (выезд с клиента и гонорар замерщика — разные суммы:
-- замер может быть «включён в договор» для клиента, но замерщику причитается).
CREATE TABLE IF NOT EXISTS public.measure_requests (
  id            bigserial PRIMARY KEY,
  deal_number   text,                -- номер сделки/заказа (0008-6)
  client_name   text NOT NULL DEFAULT '',
  phone         text,
  amo_url       text,
  address       text,
  scope         text,                -- что мерить: изделие, размеры, особенности
  notes         text,                -- доступ, парковка, пожелания по времени
  visit_price   numeric(10,2) NOT NULL DEFAULT 0,   -- сколько берём с клиента за выезд
  payer         text,                -- кто платит (клиент / включено в договор)
  is_repeat     boolean NOT NULL DEFAULT false,     -- повторный замер
  raw_text      text,                -- исходная диктовка/вставка менеджера
  structured_text text,              -- готовое сообщение по канону (для отправки клиенту/замерщику)

  manager_id    uuid REFERENCES public.users(id),
  manager_name  text,
  measurer_id   uuid REFERENCES public.users(id),   -- кто взял замер
  measurer_name text,
  scheduled_at  timestamptz,         -- NULL, пока замерщик не договорился
  duration_min  int NOT NULL DEFAULT 90,

  status        text NOT NULL DEFAULT 'new'
                CHECK (status IN ('new','scheduled','done','issue','cancelled')),
  issue_text    text,                -- сложность (как у производства)
  issue_solution text,               -- предлагаемое решение

  measurer_fee  numeric(10,2) NOT NULL DEFAULT 0,   -- причитается замерщику
  fee_status    text NOT NULL DEFAULT 'pending' CHECK (fee_status IN ('pending','paid')),
  fee_paid_at   timestamptz,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS measure_requests_status_idx ON public.measure_requests (status, scheduled_at);
CREATE INDEX IF NOT EXISTS measure_requests_measurer_idx ON public.measure_requests (measurer_id, scheduled_at);

ALTER TABLE public.measure_requests ENABLE ROW LEVEL SECURITY;
-- Внутренняя команда: читают и пишут все авторизованные (менеджеры создают,
-- замерщики назначают/закрывают, владелец отмечает выплаты). Тонкое
-- разграничение — на уровне UI; ужесточить RLS можно отдельной миграцией.
DROP POLICY IF EXISTS measure_requests_all ON public.measure_requests;
CREATE POLICY measure_requests_all ON public.measure_requests FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Роль «замерщик»: users.role_check в базовой схеме устарел и мешает — снимаем.
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
