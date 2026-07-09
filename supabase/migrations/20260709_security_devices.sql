-- Безопасность входа: лимит устройств (1 телефон + 1 ПК на аккаунт) + журнал событий.
-- Политика: новый вход на устройстве того же класса ВЫТЕСНЯЕТ предыдущее устройство
-- (kick-old): шаринг аккаунта превращается в пинг-понг разлогинов и виден в журнале.

create table if not exists user_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null,                 -- httpOnly кука device-id (uuid, 400 дней)
  device_class text not null check (device_class in ('mobile','desktop')),
  user_agent text,
  last_ip text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_reason text
);
-- одна АКТИВНАЯ запись на (пользователь, класс устройства)
create unique index if not exists user_devices_one_active
  on user_devices (user_id, device_class) where revoked_at is null;
create index if not exists user_devices_user on user_devices (user_id);

create table if not exists security_events (
  id bigserial primary key,
  user_id uuid,
  email text,
  event text not null,   -- login | device_registered | device_replaced | device_kicked | logout_forced
  device_class text,
  user_agent text,
  ip text,
  meta jsonb,
  created_at timestamptz not null default now()
);
create index if not exists security_events_created on security_events (created_at desc);
create index if not exists security_events_user on security_events (user_id, created_at desc);

alter table user_devices enable row level security;
alter table security_events enable row level security;

-- пользователь читает только свои устройства (нужно middleware для проверки);
-- вся запись — только через service role (API), политик insert/update нет
drop policy if exists user_devices_select_own on user_devices;
create policy user_devices_select_own on user_devices for select using (auth.uid() = user_id);
