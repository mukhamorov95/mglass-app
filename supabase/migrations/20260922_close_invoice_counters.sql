-- Находка первого прогона доступов: на deal_invoice_counters не было RLS вовсе,
-- а гранты у anon есть — значит посторонний мог читать и двигать счётчик номеров
-- счетов по сделкам. Номер выдаёт функция next_deal_invoice_number (сервисный
-- ключ), с клиента к таблице никто не обращается — проверено по коду.
--
-- Включаем RLS без политик: сервисный ключ RLS обходит и продолжает работать,
-- всем остальным таблица закрыта. И снимаем у anon права на неё.
alter table deal_invoice_counters enable row level security;
revoke all on deal_invoice_counters from anon;

-- Очередь задач владельца читалась без входа в систему: политика
-- «(NOT is_partner())» анонима не отсекает. Запись и так была только владельцу.
drop policy if exists "task_queue_read" on task_queue;
create policy "task_queue_read" on task_queue
  for select to authenticated using (not is_partner());
revoke all on task_queue from anon;

-- Фотографии работ для сайта читаются анонимом намеренно (витрина, только
-- approved = true) — это оставляем. Но права записи у anon не нужны.
revoke insert, update, delete on site_work_photos from anon;

-- Журнал активности: политики уже проверяют auth.uid() = user_id, права
-- анонима тут лишние.
revoke all on user_activity_days from anon;
