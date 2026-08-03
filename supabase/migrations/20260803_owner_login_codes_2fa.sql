-- 2FA-коды входа для владельца (owner-tier). Транзиентное хранилище: одна строка
-- на пользователя, код хранится хешем (sha-256), с TTL и лимитом попыток.
create table if not exists owner_login_codes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  created_at timestamptz not null default now()
);
-- Читается/пишется только сервером через service-role. RLS включён без политик —
-- снаружи (anon/authenticated) недоступно вообще.
alter table owner_login_codes enable row level security;
