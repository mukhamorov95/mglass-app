-- Одноразовые токены для самостоятельной установки пароля (приглашение/сброс).
-- Пользователь задаёт пароль сам по ссылке — админ его не вводит и не знает.
create table if not exists user_setup_tokens (
  token_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists user_setup_tokens_user_idx on user_setup_tokens(user_id);
-- Только сервер (service-role). RLS без политик — снаружи недоступно.
alter table user_setup_tokens enable row level security;
