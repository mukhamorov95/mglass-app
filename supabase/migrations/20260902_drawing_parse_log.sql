-- Лог разбора чертежа: кто запускал, что вышло.
--
-- 02.09.2026 не удалось ответить на вопрос «почему у 49 заказов с чертежами нет
-- ни одного диаметра»: записей о запусках разбора не существовало вовсе, и ответ
-- пришлось собирать SELECT'ом по последствиям — по тому, что осело в позициях.
-- Кнопкой пользуются трое менеджеров из шести, и до сих пор это было видно только
-- косвенно.
--
-- Своя таблица, а не `agent_logs`: там autonomous-агенты, и их читают лента
-- `/admin/agents` (select *) и сводка `cron/agent-ceo` (последние 50 за день).
-- Десяток разборов в день вытеснил бы оттуда то, ради чего эти читатели написаны.
--
-- Содержимое файла не храним: чертёж — данные клиента, а на вопрос «запускался ли
-- разбор и что он нашёл» имя, тип и размер отвечают полностью.

create table if not exists public.drawing_parse_log (
  id                  bigserial primary key,
  created_at          timestamptz not null default now(),
  route               text        not null,
  user_id             uuid,
  user_name           text,
  file_name           text,
  file_type           text,
  file_size_kb        integer,
  duration_ms         integer,
  ok                  boolean     not null,
  items_found         integer     not null default 0,
  -- Два разных сигнала: сколько деталей с отверстиями и у скольких в тексте есть
  -- диаметр. Именно они отличают «разбор не запускали» от «запускали, а диаметров
  -- в чертеже не было» — вопрос, на который в сентябре ответить было нечем.
  items_with_holes    integer     not null default 0,
  items_with_diameter integer     not null default 0,
  error               text
);

create index if not exists drawing_parse_log_created_idx on public.drawing_parse_log (created_at desc);
create index if not exists drawing_parse_log_user_idx    on public.drawing_parse_log (user_id, created_at desc);

-- Пишет только сервер (service-role), читает только владелец. Политик для anon
-- и authenticated нет сознательно: в строке видно, кто и какой файл загружал.
alter table public.drawing_parse_log enable row level security;

drop policy if exists drawing_parse_log_owner_read on public.drawing_parse_log;
create policy drawing_parse_log_owner_read on public.drawing_parse_log
  for select to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role in ('admin','ceo')));

comment on table public.drawing_parse_log is
  'Запуски разбора чертежа (/api/ai/parse-drawing и /api/b2b/parse-pdf): кто, когда, что нашёл. Заведён 02.09.2026 — до этого запусков не было видно вовсе.';
