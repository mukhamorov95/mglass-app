-- Личный контур, фаза 2-3: надиктовки → задачи по ролям, спорт, настройки.
-- База vlad-personal (fohycmghypcfjkuznnmu). RLS без политик — доступ только
-- service-ключом с сервера. Этот файл — документация применённого DDL.

create table vlad_notes (
  id bigserial primary key,
  audio_path text,                      -- файл в bucket vlad-audio (webm)
  transcript text,                      -- расшифровка; исходник не теряем никогда
  source text not null default 'voice' check (source in ('voice','text')),
  status text not null default 'new' check (status in ('new','parsed','error')),
  error text,
  task_id bigint,                       -- если надиктовка — дополнение к задаче
  created_at timestamptz not null default now()
);

create table vlad_tasks (
  id bigserial primary key,
  note_id bigint references vlad_notes(id) on delete set null,
  role text not null default 'ceo' check (role in ('ceo','manager','cfo','production','father','husband','son','brother','other')),
  kind text not null default 'task' check (kind in ('task','decide','think','commitment')),
  title text not null,                  -- выжимка одной фразой
  details text,                         -- полные подробности, дописываются надиктовками
  due_date date,
  contact text,                         -- с кем скоммуницировать
  steps jsonb not null default '[]',    -- [{"text":"...","done":false}]
  status text not null default 'inbox' check (status in ('inbox','active','done','dropped')),
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index vlad_tasks_status_idx on vlad_tasks (status, due_date nulls last);

create table vlad_sport (
  id bigserial primary key,
  day date not null,
  exercise text not null,
  done boolean not null default false,
  unique (day, exercise)
);

create table vlad_settings (
  key text primary key,
  value jsonb not null
);
insert into vlad_settings (key, value) values
  ('sport_exercises', '["Отжимания","Приседания","Пресс"]'::jsonb),
  ('ics_secret', to_jsonb(replace(gen_random_uuid()::text,'-','')));

alter table vlad_notes enable row level security;
alter table vlad_tasks enable row level security;
alter table vlad_sport enable row level security;
alter table vlad_settings enable row level security;
