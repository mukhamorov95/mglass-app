-- Память уроков скана дизайн-проектов: заметки менеджеров при повторном поиске
-- сохраняются и подмешиваются в системный промпт всех будущих сканов.
create table if not exists design_scan_lessons (
  id bigserial primary key,
  lesson text not null,
  author_name text,
  created_at timestamptz not null default now()
);

alter table design_scan_lessons enable row level security;

drop policy if exists "dsl_auth_all" on design_scan_lessons;
create policy "dsl_auth_all" on design_scan_lessons
  for all to authenticated using (true) with check (true);
