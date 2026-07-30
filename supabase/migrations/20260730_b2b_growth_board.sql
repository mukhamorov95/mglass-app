-- Доска развития B2B: гипотезы, решения, проблемы, чек-лист, обзвон цехов, воронка канала.
-- Применена через MCP apply_migration (b2b_growth_board). Файл — для истории репозитория.
create table if not exists b2b_growth_items (
  id bigserial primary key,
  kind text not null check (kind in ('hypothesis','decision','problem','checklist','call_target','channel_stage')),
  title text not null,
  detail text,
  status text,
  impact text,
  contact text,
  segment text,
  sort_order int default 0,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists b2b_growth_items_kind_idx on b2b_growth_items(kind, sort_order, created_at);

alter table b2b_growth_items enable row level security;
drop policy if exists b2b_growth_read on b2b_growth_items;
drop policy if exists b2b_growth_write on b2b_growth_items;
create policy b2b_growth_read on b2b_growth_items for select to authenticated using (true);
create policy b2b_growth_write on b2b_growth_items for all to authenticated using (true) with check (true);
