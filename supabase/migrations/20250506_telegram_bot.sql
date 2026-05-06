-- Telegram Bot Phase 1 Migration

create table if not exists public.telegram_users (
  telegram_id   bigint primary key,
  user_id       uuid not null references public.users(id) on delete cascade,
  first_name    text,
  username      text,
  linked_at     timestamptz not null default now()
);

create table if not exists public.telegram_sessions (
  telegram_id   bigint primary key,
  state         text not null default 'main_menu',
  context       jsonb not null default '{}',
  updated_at    timestamptz not null default now()
);

create table if not exists public.telegram_auth_codes (
  code          char(6) primary key,
  user_id       uuid not null references public.users(id) on delete cascade,
  expires_at    timestamptz not null default (now() + interval '15 minutes'),
  used          boolean not null default false,
  created_at    timestamptz not null default now()
);

create table if not exists public.ai_training_tasks (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  description   text,
  source_text   text not null,
  category      text,
  priority      text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  status        text not null default 'pending' check (status in ('pending', 'in_progress', 'done', 'rejected')),
  created_by    uuid references public.users(id),
  created_at    timestamptz not null default now()
);
