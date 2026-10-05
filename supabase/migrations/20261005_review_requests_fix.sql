-- Индекс 24.09 стоял на выражении coalesce(amo_lead_id, 0), а upsert ссылается на
-- колонки (phone, amo_lead_id) — Postgres не находит подходящий индекс (42P10), и
-- «Собрать очередь» падал на каждом запуске: очередь пуста с 24.09.
-- nulls not distinct держит ту же идемпотентность для строк без сделки.
drop index if exists review_requests_unique_lead;
create unique index if not exists review_requests_phone_lead
  on review_requests (phone, amo_lead_id) nulls not distinct;

-- sending — строка взята в отправку. Без него две вкладки (или повтор после таймаута)
-- берут одну и ту же строку, и человек получает просьбу дважды.
alter table review_requests drop constraint if exists review_requests_status_check;
alter table review_requests add constraint review_requests_status_check
  check (status in ('pending','sending','sent','failed','skipped','replied','review_left'));
