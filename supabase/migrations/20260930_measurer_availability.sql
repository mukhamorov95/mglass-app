-- Занятость замерщиков: рабочие часы и выходные/отпуска. Нужны доске «когда
-- можно на замер» и проверке назначения (lib/measure/slots.ts).
-- Читает и пишет только сервер (/api/measure-requests/board, /api/measurers/*) после
-- проверки прав; из браузера — только своё и владельцу (причина отпуска — личное).

create table if not exists public.measurer_schedules (
  user_id uuid primary key references public.users(id) on delete cascade,
  work_days smallint[] not null default '{1,2,3,4,5,6}',  -- ISO: 1 пн … 7 вс
  work_from time not null default '09:00',
  work_to time not null default '20:00',
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint measurer_schedules_hours check (work_from < work_to)
);

create table if not exists public.measurer_days_off (
  id bigserial primary key,
  measurer_id uuid not null references public.users(id) on delete cascade,
  date_from date not null,
  date_to date not null,
  note text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  constraint measurer_days_off_range check (date_from <= date_to)
);
create index if not exists measurer_days_off_measurer_idx on public.measurer_days_off (measurer_id, date_to);

alter table public.measurer_schedules enable row level security;
alter table public.measurer_days_off enable row level security;

drop policy if exists measurer_schedules_read on public.measurer_schedules;
create policy measurer_schedules_read on public.measurer_schedules
  for select to authenticated using (public.is_owner() or user_id = (select auth.uid()));

drop policy if exists measurer_days_off_read on public.measurer_days_off;
create policy measurer_days_off_read on public.measurer_days_off
  for select to authenticated using (public.is_owner() or measurer_id = (select auth.uid()));

revoke all on public.measurer_schedules, public.measurer_days_off from anon;
revoke insert, update, delete on public.measurer_schedules, public.measurer_days_off from authenticated;
revoke all on sequence public.measurer_days_off_id_seq from anon, authenticated;
