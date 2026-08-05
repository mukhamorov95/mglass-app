-- Воркер-захват задач владельца («клад»): heartbeat + атомарный claim.

-- Кто и когда был активен как воркер на машине.
create table if not exists owner_task_workers (
  worker_id text primary key,
  machine   text,
  last_seen timestamptz not null default now()
);
alter table owner_task_workers enable row level security;  -- доступ только через service_role

-- Атрибуты захвата на задаче.
alter table owner_tasks add column if not exists claimed_by text;
alter table owner_tasks add column if not exists claimed_at timestamptz;

-- Атомарно забрать следующую задачу из очереди (без гонок между воркерами).
create or replace function claim_next_owner_task(p_worker text)
returns owner_tasks
language plpgsql
security definer
set search_path = public
as $$
declare t owner_tasks;
begin
  update owner_tasks
     set status = 'in_progress', claimed_by = p_worker, claimed_at = now(), updated_at = now()
   where id = (
     select id from owner_tasks
      where status = 'queued'
      order by (case priority when 'high' then 0 when 'normal' then 1 else 2 end), created_at
      limit 1
      for update skip locked
   )
  returning * into t;
  return t;  -- null, если очередь пуста
end $$;

revoke execute on function claim_next_owner_task(text) from anon, authenticated;
