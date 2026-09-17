-- Рекомендации AI Control Center: сохраняются и требуют решения владельца (17.09.2026).
--
-- Раньше рекомендации жили в localStorage одного браузера: клиент придумывал id
-- «ai_<время>», а колонка id — uuid, запись падала молча. В таблице было 0 строк.
-- Теперь каждая рекомендация — строка с полным содержанием, на неё реагируют:
-- «в работу» (дальше «сделано» с результатом), «в архив» или «убрать».

alter table public.ai_recommendations
  add column if not exists problem      text,
  add column if not exists impact       text,
  add column if not exists action       text,
  add column if not exists metric       text,
  add column if not exists perspective  text,
  add column if not exists decided_at   timestamptz,
  add column if not exists decided_by   text,
  add column if not exists result_note  text,
  add column if not exists done_at      timestamptz;

update public.ai_recommendations set status = case status
  when 'pending' then 'new' when 'implementing' then 'in_work' when 'deferred' then 'archived'
  when 'dismissed' then 'removed' else status end;

alter table public.ai_recommendations alter column status set default 'new';
alter table public.ai_recommendations drop constraint if exists ai_recommendations_status_check;
alter table public.ai_recommendations add constraint ai_recommendations_status_check
  check (status in ('new','in_work','done','archived','removed'));

create index if not exists ai_recommendations_status_idx on public.ai_recommendations (status, created_at desc);

alter table public.ai_recommendations enable row level security;
revoke all on public.ai_recommendations from anon, authenticated;
