-- Флаг «переварено»: Claude при старте dev-сессии разбирает свежие уроки,
-- вшивает обобщённые правила в SYSTEM промпт scan-design и помечает digested.
-- Непереваренные уроки подмешиваются в промпт сканов как есть (лимит 30).
alter table design_scan_lessons add column if not exists digested boolean not null default false;
