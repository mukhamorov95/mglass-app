-- Задачи/напоминания по лиду — ядро amoCRM: у активного лида всегда есть
-- следующая задача (позвонить, замер, КП…), просроченные всплывают у менеджера
-- и в ленте владельца. Ничего существующего не трогает. Изоляция — в коде
-- (как у crm_leads), RLS permissive для authenticated.
create table if not exists crm_tasks (
  id bigserial primary key,
  lead_id bigint not null references crm_leads(id) on delete cascade,
  title text not null,
  kind text not null default 'followup' check (kind in ('call','meeting','measure','followup','other')),
  due_at timestamptz not null,
  done boolean not null default false,
  done_at timestamptz,
  assignee text,           -- имя менеджера (как crm_leads.manager)
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists idx_crm_tasks_open on crm_tasks (due_at) where done = false;
create index if not exists idx_crm_tasks_lead on crm_tasks (lead_id);
create index if not exists idx_crm_tasks_assignee on crm_tasks (assignee) where done = false;

alter table crm_tasks enable row level security;
drop policy if exists crm_tasks_all on crm_tasks;
create policy crm_tasks_all on crm_tasks for all to authenticated using (true) with check (true);
